import type { EndingV1 } from "./schema/v1";

/**
 * The "Made with FormCraft" badge (PRD P2.1). Shown unless the
 * workspace's plan allows removing it *and* the creator switched it off
 * on that ending. The plan is checked on the server that renders the
 * public form, so editing a form's settings alone can't remove it.
 */
export function showsMadeWith(ending: EndingV1, brandingRemovable: boolean): boolean {
  return !brandingRemovable || ending.showMadeWith !== false;
}
