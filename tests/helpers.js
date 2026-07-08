// Berliner Wandzeit in der UTC-Repräsentation der App (siehe ics.js)
export const wallDate = (y, mo, d, h = 0, mi = 0, s = 0) => new Date(Date.UTC(y, mo, d, h, mi, s));
