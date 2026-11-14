import { Reply } from "lucide-react";
import { timeAgo } from "../lib/api";
import { useReply } from "../components/ReplyModal";
import { useViewer } from "../components/EmailViewer";

type Props = {
  threadId: string;
  contact: string;
  /** One line saying what it's about (the AI summary, or the subject when there is none). */
  text: string;
  at: string;
  needsReply?: boolean;
  urgent?: boolean;
  topic?: string | null;
  /** Shown instead of "x ago", e.g. "Waiting 3 days". */
  when?: string;
};

/** One conversation in a dashboard list: who, what, when. Click to read it all; Reply to answer. */
export function ConversationRow({ threadId, contact, text, at, needsReply, urgent, topic, when }: Props) {
  const openViewer = useViewer((s) => s.open);
  const openReply = useReply((s) => s.open);
  return (
    <li className="convo">
      <button className="convo-main" onClick={() => openViewer(threadId)} aria-label={`Open conversation with ${contact}: ${text}`}>
        <span className="convo-top">
          <span className="convo-who">{contact}</span>
          <span className="convo-when num">{when ?? timeAgo(at)}</span>
        </span>
        <span className="convo-text">{text}</span>
        {(needsReply || urgent || topic) && (
          <span className="convo-tags">
            {urgent && <span className="tag tag-sm" data-tone="warn">Urgent</span>}
            {needsReply && <span className="tag tag-sm" data-tone="accent">Needs reply</span>}
            {topic && <span className="tag tag-sm">{topic}</span>}
          </span>
        )}
      </button>
      <button className="icon-btn convo-reply" onClick={() => openReply(threadId, contact)} aria-label={`Reply to ${contact}`} title="Reply">
        <Reply size={16} />
      </button>
    </li>
  );
}
