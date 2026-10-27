import type { Guide } from "../types";

/** M5. Open to anyone with the link: it is what a person needs before they have an account. */
export const signIn: Guide = {
  code: "M5",
  slug: "sign-in",
  title: "Sign in with a code",
  lede: "There is no password to remember. We send you a six-digit code, you type it in, and you are in.",
  forWho: "For everyone",
  audience: ["member"],
  public: true,
  minutes: 3,
  art: "sign-in",
  ready: ["Your email address, or your WhatsApp number", "Your phone or computer, with that email or WhatsApp open"],
  ifDifferent: "If your screen does not look like these pictures, the page may have been updated. The words on the buttons will still match. Ask your tribe leader or the church office.",
  next: ["find-your-tribe"],
  parts: [
    {
      title: "Sign in",
      blurb: "New here? The same steps make your account.",
      steps: [
        {
          id: "open-sign-in",
          title: "Open the sign-in page",
          do: ["Open the United Tribes link you were sent.", "You will see **Sign in** and your choices underneath."],
          tip: "New here? You do not need to sign up first. The same steps create your account.",
          shot: {
            cast: "visitor",
            path: "/sign-in",
            ring: [{ role: "heading", name: "Sign in" }],
            tag: "Start here",
            alt: "The Sign in page, with the heading Sign in ringed.",
          },
        },
        {
          id: "type-email",
          title: "Type your email address",
          do: ["Tap the box under [[Email address]] and type the email you check most often."],
          careful: "Check each letter. A code sent to a mistyped address will never arrive.",
          shot: {
            cast: "visitor",
            path: "/sign-in",
            before: [{ do: "fill", on: { label: "Email address" }, value: "tolu.example@example.org" }],
            ring: [{ label: "Email address" }],
            tag: "Your email",
            alt: "The email box, filled in.",
          },
        },
        {
          id: "ask-for-code",
          title: "Ask for your code",
          do: ["Press [[Email me a code]]."],
          shot: {
            cast: "visitor",
            path: "/sign-in",
            before: [{ do: "fill", on: { label: "Email address" }, value: "tolu.example@example.org" }],
            ring: [{ role: "button", name: "Email me a code" }],
            tag: "Press",
            alt: "The Email me a code button, ringed.",
          },
        },
        {
          id: "type-code",
          title: "Type the six-digit code",
          do: ["Open your email and find the message from United Tribes.", "Type the six numbers into the boxes. You will be taken in by itself."],
          tip: "No email yet? Look in your spam folder, wait a minute, then press [[Send a new code]].",
          shot: {
            cast: "visitor",
            path: "/sign-in",
            before: [
              { do: "fill", on: { label: "Email address" }, value: "tolu.example@example.org" },
              { do: "click", on: { role: "button", name: "Email me a code" } },
              { do: "wait", on: { role: "heading", name: "Check your email" } },
            ],
            ring: [{ role: "heading", name: "Check your email" }, { label: "Six-digit code" }],
            tag: "Six numbers",
            alt: "The Check your email page, with the six code boxes ringed.",
          },
        },
        {
          id: "whatsapp",
          title: "Or ask for it on WhatsApp",
          do: ["Choose [[WhatsApp]] instead of Email, and type your WhatsApp number."],
          tip: "WhatsApp is there when your church has switched it on. If it is not, use your email.",
          shot: {
            cast: "visitor",
            path: "/sign-in",
            ring: [{ role: "tab", name: "WhatsApp" }],
            tag: "Or here",
            alt: "The Email and WhatsApp choice, with WhatsApp ringed.",
          },
        },
        {
          id: "google",
          title: "Or use your Google account",
          do: ["Press [[Continue with Google]] and choose your account."],
          shot: {
            cast: "visitor",
            path: "/sign-in",
            ring: [{ role: "button", name: "Continue with Google" }],
            tag: "Or here",
            alt: "The Continue with Google button, ringed.",
          },
        },
        {
          id: "add-to-phone",
          title: "Put United Tribes on your phone",
          do: [
            "On an **iPhone**, open the link in Safari, tap the Share button, then **Add to Home Screen**.",
            "On an **Android phone**, open it in Chrome, tap the three dots, then **Add to Home screen** or **Install app**.",
          ],
          why: "After this, United Tribes opens from its own icon, like any other app, and your week is one tap away.",
        },
      ],
    },
    {
      title: "What happens next",
      blurb: "You are in. Here is where you land.",
      steps: [
        {
          id: "you-are-in",
          title: "You land on Home",
          do: ["Home shows where you are in the season and the next thing to do."],
          timeline: [
            { when: "The first time", what: "Home shows **Find your tribe** with a Start button." },
            { when: "Every time after", what: "Home shows your week, and your tribe once you have joined one." },
          ],
          shot: {
            cast: "new-member",
            path: "/home",
            ring: [{ role: "heading", name: "Find your tribe." }],
            tag: "Next step",
            alt: "The Home page of someone new, with the Find your tribe panel ringed.",
          },
        },
      ],
    },
  ],
};
