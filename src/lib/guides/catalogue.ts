import { afterYouApply } from "./content/after-you-apply";
import { appointedToLead } from "./content/appointed-to-lead";
import { askAboutAPlace } from "./content/ask-about-a-place";
import { assistantLeader } from "./content/assistant-leader";
import { beReached } from "./content/be-reached";
import { contactGaps } from "./content/contact-gaps";
import { reachYourTribe } from "./content/reach-your-tribe";
import { leaderCards } from "./content/leader-cards";
import { leaderQuestions } from "./content/leader-questions";
import { placeOrMoveAMember } from "./content/place-or-move-a-member";
import { applyToLead } from "./content/apply-to-lead";
import { decideAPlaceChange } from "./content/decide-a-place-change";
import { findYourTribe } from "./content/find-your-tribe";
import { giveAReference } from "./content/give-a-reference";
import { joinYourTribe } from "./content/join-your-tribe";
import { leaderAcademy } from "./content/leader-academy";
import { parentPermission } from "./content/parent-permission";
import { runYourWeek } from "./content/run-your-week";
import { shareATestimony } from "./content/share-a-testimony";
import { signIn } from "./content/sign-in";
import { sendByWhatsapp } from "./content/send-by-whatsapp";
import { whatsappHealth } from "./content/whatsapp-health";
import { whatsappMode } from "./content/whatsapp-mode";
import { yourInformation } from "./content/your-information";
import { youHaveBeenPlaced } from "./content/you-have-been-placed";
import { yourTribesSeason } from "./content/your-tribes-season";
import { yourWeek } from "./content/your-week";
import type { Guide } from "./types";

/**
 * Every guide in the library, in the order of the plan. The Tribe Card guide (L0) was made first and lives at /tutorial; the library page
 * lists it and links to it, and it is not in this list.
 */
export const GUIDES: readonly Guide[] = [signIn, findYourTribe, joinYourTribe, yourWeek, shareATestimony, yourInformation, applyToLead, afterYouApply, leaderAcademy, runYourWeek, yourTribesSeason, appointedToLead, askAboutAPlace, assistantLeader, whatsappHealth, decideAPlaceChange, giveAReference, parentPermission, youHaveBeenPlaced, whatsappMode, sendByWhatsapp, contactGaps, beReached, placeOrMoveAMember, leaderCards, reachYourTribe, leaderQuestions];

export const guideBySlug = (slug: string): Guide | undefined => GUIDES.find((g) => g.slug === slug);
