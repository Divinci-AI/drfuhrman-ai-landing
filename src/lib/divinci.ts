import { createClient, type DivinciClient } from "@divinci-ai/client";

export const API_BASE = "https://api.stage.divinci.app";
export const WHITELABEL_ID = "69995f9a7824ced78b66686c";
export const RELEASE_ID = "6a118e81e44ce78e97327aa8";

// Anonymous-visitor quota: how many user messages can be sent before
// the upgrade gate appears. v1: one free message after email capture.
export const FREE_MESSAGE_QUOTA = 1;

// Where to send users after they've exhausted the free quota.
// Tagged downstream via withRef() so DrFuhrman.com can attribute
// signups from this landing page in their analytics.
import { withRef } from "./links";
export const SIGNUP_URL = withRef(
  "https://www.drfuhrman.com/membership",
  "free-message-quota-cta",
);
// Existing DrFuhrman.com members log in on their membership site.
export const LOGIN_URL = withRef(
  "https://www.drfuhrman.com/login",
  "free-message-quota-cta",
);

let cached: DivinciClient | null = null;

export function getDivinci(): DivinciClient {
  if (!cached) {
    cached = createClient({
      releaseId: RELEASE_ID,
      baseUrl: API_BASE,
    });
  }
  return cached;
}

export interface ReleaseConfig {
  welcomeMessage: string | null;
  starters: string[];
}

export const FALLBACK_RELEASE: ReleaseConfig = {
  welcomeMessage:
    "Hi, I'm Dr. Joel Fuhrman's AI. I'm here to help you take back control of your health — what's been on your mind lately?",
  starters: [
    "Hi, Dr. Fuhrman AI. Can you tell me steps I can take about starting a healthier lifestyle?",
    "Hi Dr. Fuhrman AI, can you tell me what Nutritarian is all about?",
    "Hi Dr. Fuhrman AI. Can you tell me about insulin sensitivity?",
  ],
};
