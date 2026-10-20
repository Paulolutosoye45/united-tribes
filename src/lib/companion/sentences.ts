import { STORY_EXAMPLES } from "@/lib/intake/options";
import { OUTCOMES_EXTRA } from "./goal-extras";

/**
 * Ready-made words for the two questions where staring at a blank box is the hardest part. Every sentence is a
 * starting point: tapping one puts it in the box, and the person changes it until it sounds like them.
 */

const BY_AGE: Record<string, readonly string[]> = {
  "18-25": [
    "I’m in my final year and I want friends who love God.",
    "I’m doing NYSC and I’m working out my next step.",
    "I’m in my first job and I’m learning to manage on my own.",
    "I want to start a business of my own before I turn thirty.",
  ],
  "26-32": [
    "I’m building my career and I want people who will keep me praying.",
    "I run a small business and I’m tired of doing it alone.",
    "I’m getting married soon and we want to start well.",
    "I’m planning a move abroad and I want my faith to move with me.",
  ],
  "33-40": [
    "We have young children and our home needs a better rhythm.",
    "I’m growing in my career, but my days are very full.",
    "I’m between jobs and trusting God for the next door.",
    "My marriage is good and we want to keep growing together.",
  ],
  "41-50": [
    "My children are teenagers and I want to parent them well.",
    "I’ve been in my career a long time and I’m asking what comes next.",
    "I lead a team and I want to lead better at home too.",
    "I run a business and I’m ready to hand some of it over.",
  ],
  "51-60": [
    "My children are grown and I’m asking what God wants from this next season.",
    "I’m thinking about retirement and how to stay useful.",
    "I want to mentor younger people who are finding their way.",
    "My health matters more to me now and I want a better routine.",
  ],
  "60-plus": [
    "I’m retired and I want to keep serving and mentoring.",
    "I want to stay close to my grandchildren and pray for them.",
    "My grandchildren keep me busy and I want friends my age who love God.",
    "I want to pray more and mentor younger people.",
  ],
};

/** Four ways to begin, chosen for the person's age group and where they live. */
export function starterSentences(ageRange?: string, zone?: string): string[] {
  const base = [...(BY_AGE[ageRange ?? ""] ?? STORY_EXAMPLES)];
  if (zone === "abroad") base[3] = "I live abroad and I miss home and my church family.";
  return base.slice(0, 4);
}

const OUTCOMES: Record<string, readonly string[]> = {
  "launch-or-formalise-a-business": [
    "By week 12, my business is registered and I can say clearly who it serves.",
    "By week 12, I have launched and made my first sale, with people praying me through it.",
    "By week 12, I have a simple plan and I’m no longer carrying this idea alone.",
  ],
  "grow-revenue-and-systems": [
    "By week 12, I have simple systems in place and my business no longer needs me to do everything.",
    "By week 12, I can see my numbers clearly and I know my next three steps.",
    "By week 12, my business has grown steadily and I still have time for my family and my faith.",
  ],
  "step-into-a-leadership-role": [
    "By week 12, I’m leading with confidence and my team can feel the difference.",
    "By week 12, I have taken a real step toward the role God is preparing me for.",
    "By week 12, I lead at work in a way I’m proud of, and I still have my peace.",
  ],
  "change-career-direction-with-confidence": [
    "By week 12, I know the direction I’m moving in and I have taken the first step.",
    "By week 12, I have spoken to people in the field I’m moving into and I’m no longer afraid of the change.",
    "By week 12, I have peace about my next season of work.",
  ],
  "build-a-steady-client-pipeline": [
    "By week 12, I have a simple way of finding clients that I can repeat every week.",
    "By week 12, I start new conversations every week and my pipeline is not empty.",
    "By week 12, I’m no longer waiting and hoping for the next client to appear.",
  ],
  "price-and-package-my-expertise": [
    "By week 12, I have clear packages and prices, and I can say them without apologising.",
    "By week 12, I charge what my work is worth and my clients say yes.",
    "By week 12, I can explain what I offer in one sentence.",
  ],
  "land-my-next-role": [
    "By week 12, I have a role I’m excited about, or an offer I’m weighing with peace.",
    "By week 12, I have a steady routine for my search and I’m no longer carrying it alone.",
    "By week 12, I have met the right people and I’m ready for the next door.",
  ],
  "retool-with-new-skills": [
    "By week 12, I have finished a course and can show something I built.",
    "By week 12, I have a new skill I can use, and I know where to use it.",
    "By week 12, I feel capable again.",
  ],
  "thrive-in-a-long-distance-family": [
    "By week 12, my family and I have a weekly time to connect, and we keep it.",
    "By week 12, I feel close to the people I love, even from far away.",
    "By week 12, I have a faith family where I am, as well as the one back home.",
  ],
  "make-a-cross-border-move-well": [
    "By week 12, I have settled well and I know where to turn for help.",
    "By week 12, I have found a community where I belong in my new place.",
    "By week 12, my move feels like a step of faith, not a leap alone.",
  ],
  "strengthen-our-marriage": [
    "By week 12, we make time to talk and pray together every week.",
    "By week 12, we understand each other better and we laugh more.",
    "By week 12, our marriage feels stronger and we know how to keep it that way.",
  ],
  "prepare-well-for-marriage": [
    "By week 12, I have had the honest conversations I needed before marriage.",
    "By week 12, I feel ready and at peace about the step ahead.",
    "By week 12, I have people I can turn to for advice as we prepare.",
  ],
  "rebuild-after-a-relationship-ends": [
    "By week 12, I feel steadier and I know I’m not walking this alone.",
    "By week 12, I have people around me and a little more hope each day.",
    "By week 12, I’m ready to look forward.",
  ],
  "build-a-faith-filled-home-rhythm": [
    "By week 12, our family has a time of prayer and devotion that we keep most days.",
    "By week 12, our home feels calmer and we know our rhythm.",
    "By week 12, my children see us pray, and they have started to join in.",
  ],
  "parent-teenagers-well": [
    "By week 12, my teenager and I talk more, and I listen better.",
    "By week 12, our home feels calmer and I feel more confident as a parent.",
    "By week 12, I have people to turn to when parenting is hard.",
  ],
  "build-a-consistent-fitness-habit": [
    "By week 12, exercise is part of my week and I no longer have to talk myself into it.",
    "By week 12, I have kept a routine for a whole season, with people cheering me on.",
    "By week 12, I feel stronger and have more energy for the people I love.",
  ],
  "reach-a-health-milestone": [
    "By week 12, I have reached the milestone I set, with a plan I can keep.",
    "By week 12, I have taken real, steady steps and I’m proud of them.",
    "By week 12, I feel healthier and I have people who kept me going.",
  ],
  "excel-in-my-studies-or-exams": [
    "By week 12, I have a study routine that works and I feel ready for my exams.",
    "By week 12, I have done my best, with peace about the results.",
    "By week 12, I have friends who prayed with me and kept me on track.",
  ],
  "grow-as-an-educator": [
    "By week 12, I have tried something new in my teaching and seen it work.",
    "By week 12, I feel more confident and more joyful in my classroom.",
    "By week 12, I have people to share ideas and burdens with.",
  ],
  "sustain-my-calling-without-burning-out": [
    "By week 12, I have rest and boundaries that I keep, and my work still feels like a calling.",
    "By week 12, I have a few people who look after me as I look after others.",
    "By week 12, I feel steady and renewed.",
  ],
  "advance-my-specialisation": [
    "By week 12, I have taken a clear step toward my next qualification.",
    "By week 12, I have a study plan and a mentor, and I’m keeping to it.",
    "By week 12, I know where I’m heading and why.",
  ],
  "finish-and-release-a-body-of-work": [
    "By week 12, I have finished the work and shared it with people I trust.",
    "By week 12, I have a release date and a small team behind me.",
    "By week 12, my work is out in the world and I’m proud of it.",
  ],
  "turn-my-craft-into-income": [
    "By week 12, I have earned from my craft, even if it is small.",
    "By week 12, I have clear prices, a place to sell, and a few people who believe in it.",
    "By week 12, I treat my craft as work worth paying for.",
  ],
};

const GENERIC_OUTCOMES: readonly string[] = [
  "By week 12, I have taken the first real step and I’m not doing it alone.",
  "By week 12, I can see clear progress and I know my next step.",
  "By week 12, I feel more at peace about this and I have people cheering me on.",
];

/** Three other ways to say how the season could end, for the goal the person chose. */
export function outcomeSentences(goalSlug: string | undefined): string[] {
  return [...(OUTCOMES[goalSlug ?? ""] ?? OUTCOMES_EXTRA[goalSlug ?? ""] ?? GENERIC_OUTCOMES)];
}
