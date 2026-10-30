/** Review statuses and limits for the records view (F-03), shared by the
 * server and the browser. */

export const REVIEW_STATUSES = ["new", "in_progress", "done"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  new: "New",
  in_progress: "In progress",
  done: "Done",
};

export const MAX_COMMENT_LENGTH = 2000;

export function isReviewStatus(value: unknown): value is ReviewStatus {
  return (
    typeof value === "string" && (REVIEW_STATUSES as readonly string[]).includes(value)
  );
}

export type ResponseComment = {
  id: string;
  body: string;
  author: string | null;
  authorId: string | null;
  createdAt: string;
};
