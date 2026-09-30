import { CopyLinkButton, OpenLiveButton } from "./live-link-actions";
import { PublishButton } from "./publish-button";

/** Right-hand header actions on non-builder form pages. */
export function FormPageActions({
  formId,
  slug,
  isLive,
}: {
  formId: string;
  slug: string;
  isLive: boolean;
}) {
  if (!isLive) return <PublishButton formId={formId} />;
  return (
    <>
      <CopyLinkButton slug={slug} />
      <OpenLiveButton slug={slug} />
    </>
  );
}
