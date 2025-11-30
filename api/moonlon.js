// api/moonlon.js
// Vercel serverless function that computes Moon ecliptic longitude (deg) using astronomia
// Install dependency: "astronomia" (package.json provided below)

const { json } = (req => req) ; // placeholder so linters don't complain (not used)

module.exports = async (req, res) => {
  try {
    // Only POST expected
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Only POST allowed' });
      return;
    }

    const body = req.body || {};
    const { dob, tob, tzOffsetMinutes } = body;

    if (!dob || !tob) {
      res.status(400).json({ error: 'dob and tob required (dob YYYY-MM-DD, tob HH:MM)' });
      return;
    }

    // lazily require astronomia (pure JS)
    let julian, moonposition;
    try {
      // CommonJS require paths
      const a = require('astronomia');
      // astronomia bundles some modules as subpaths
      // attempt to pick julian and moonposition from the package
      julian = a.julian || require('astronomia/lib/julian') || require('astronomia/julian');
      moonposition = require('astronomia/moonposition');
    } catch (e) {
      // Fallback attempt - some installs expose modules differently
      try {
        julian = require('astronomia/lib/julian');
        moonposition = require('astronomia/lib/moonposition');
      } catch (err2) {
        console.error('astronomia require failed:', err2);
        res.status(500).json({ error: 'Server missing dependency "astronomia". Please ensure package.json includes astronomia and redeploy.' });
        return;
      }
    }

    // parse dob/tob
    const [y, m, d] = String(dob).split('-').map(Number);
    const [hh, mm] = String(tob).split(':').map(Number);

    // Determine UTC time from local by using tzOffsetMinutes from client (js getTimezoneOffset)
    // JS getTimezoneOffset returns minutes to add to local time to get UTC (e.g. IST => -330)
    const tzMin = (typeof tzOffsetMinutes === 'number') ? tzOffsetMinutes : 0;

    // Create a Date using given local components (server side we just compute JD using the local datetime corrected to UTC)
    // Construct a JS Date in UTC using the supplied local parts (treat as local)
    // We'll compute UT by subtracting tzOffsetMinutes
    const localDate = new Date(y, m - 1, d, hh, mm, 0, 0);
    const utMillis = localDate.getTime() + (tzMin * 60000); // because tzMin = getTimezoneOffset()
    const ut = new Date(utMillis);

    // compute Julian Day (UT)
    // astronomia/julian has CalendarGregorianToJD(year, month, day) but we'll compute fractional JD with hours
    // Some builds expose julian.CalendarGregorianToJD
    let jd;
    if (julian && typeof julian.CalendarGregorianToJD === 'function') {
      const day = ut.getUTCDate();
      const month = ut.getUTCMonth() + 1;
      const year = ut.getUTCFullYear();
      const hr = ut.getUTCHours() + ut.getUTCMinutes()/60 + ut.getUTCSeconds()/3600;
      jd = julian.CalendarGregorianToJD(year, month, day) + hr/24;
    } else if (julian && typeof julian.toJD === 'function') {
      // alternative naming
      const y2 = ut.getUTCFullYear(), m2 = ut.getUTCMonth()+1, d2 = ut.getUTCDate();
      jd = julian.toJD(y2, m2, d2, ut.getUTCHours(), ut.getUTCMinutes(), ut.getUTCSeconds());
    } else {
      // fallback simple JD computation (sufficient precision)
      const Y = ut.getUTCFullYear(), M = ut.getUTCMonth()+1, D = ut.getUTCDate();
      const H = ut.getUTCHours(), MIN = ut.getUTCMinutes(), S = ut.getUTCSeconds();
      const dayFrac = (H + MIN/60 + S/3600)/24;
      // algorithm from Meeus
      let yy = Y, mm2 = M;
      if (mm2 <= 2) { yy = Y - 1; mm2 = M + 12; }
      const A = Math.floor(yy/100);
      const B = 2 - A + Math.floor(A/4);
      const JD0 = Math.floor(365.25*(yy + 4716)) + Math.floor(30.6001*(mm2+1)) + D + B - 1524.5;
      jd = JD0 + dayFrac;
    }

    // compute moon position at jd (astronomia moonposition.position expects jd in days)
    // moonposition.position(jd) returns {lon: rad, lat: rad, range: km} in many builds
    let pos;
    try {
      pos = moonposition.position(jd);
    } catch (e) {
      // If API differs, try alternative call signatures
      if (typeof moonposition.position === 'function') {
        pos = moonposition.position(jd);
      } else if (typeof moonposition.true === 'function') {
        pos = moonposition.true(jd);
      } else {
        throw e;
      }
    }

    // pos.lon likely in radians; convert to degrees
    let lonDeg;
    if (pos && typeof pos.lon === 'number') {
      lonDeg = pos.lon * 180 / Math.PI;
    } else if (pos && typeof pos[0] === 'number') {
      // some libs return array [lon, lat, range]
      lonDeg = pos[0] * 180 / Math.PI;
    } else {
      throw new Error('Unexpected moonposition result: ' + JSON.stringify(pos));
    }

    // Normalize to 0..360
    lonDeg = ((lonDeg % 360) + 360) % 360;

    return res.status(200).json({ moonLongitude: parseFloat(lonDeg.toFixed(6)), jd });
  } catch (err) {
    console.error('moonlon error', err && err.stack ? err.stack : err);
    res.status(500).json({ error: (err && err.message) ? err.message : String(err) });
  }
};
