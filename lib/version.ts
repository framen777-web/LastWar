// Bump these as part of the commit for any change worth marking. Major: +1, minor resets to 0.
// Minor: +1, major unchanged. Format is always 2-digit major . 4-digit minor, e.g. "02.0023".
const MAJOR = 2;
const MINOR = 14;

export const APP_VERSION = `${String(MAJOR).padStart(2, "0")}.${String(MINOR).padStart(4, "0")}`;
