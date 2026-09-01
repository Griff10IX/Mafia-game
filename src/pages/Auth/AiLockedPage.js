import InsultGatePage from "./InsultGatePage";
import { LOCKED_LINES } from "./kickedCopy";

export default function AiLockedPage() {
  return (
    <InsultGatePage
      label="You have been locked"
      lines={LOCKED_LINES}
    />
  );
}
