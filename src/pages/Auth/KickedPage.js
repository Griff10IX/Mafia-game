import InsultGatePage from "./InsultGatePage";
import { KICKED_LINES } from "./kickedCopy";

export default function KickedPage() {
  return (
    <InsultGatePage
      label="You have been logged out"
      lines={KICKED_LINES}
      primaryHref="/"
      primaryLabel="Log back in"
    />
  );
}
