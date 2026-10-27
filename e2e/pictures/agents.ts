/** What a person's browser says about itself. The test browser calls itself "HeadlessChrome", which the app rightly treats as a program. */
export const PHONE_UA = (v: string) => `Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Mobile Safari/537.36`;
export const DESKTOP_UA = (v: string) => `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
