import type { Poll } from "../../../shared/types";
import { percent, plural } from "../lib/format";

interface Props {
  poll: Poll;
  myOptionId?: number;
  size?: "regular" | "screen";
}

/** Horizontal results. The leading option is drawn in ink; "your vote" is marked in marigold. */
export function ResultBars({ poll, myOptionId, size = "regular" }: Props) {
  const max = Math.max(0, ...poll.options.map((o) => o.votes));
  return (
    <div className={`results results--${size}`}>
      <ol className="results__list" aria-label={`Results: ${plural(poll.totalVotes, "vote")}`}>
        {poll.options.map((option) => {
          const pct = percent(option.votes, poll.totalVotes);
          const leading = option.votes > 0 && option.votes === max;
          const mine = option.id === myOptionId;
          return (
            <li key={option.id} className={`result ${leading ? "is-leading" : ""} ${mine ? "is-mine" : ""}`}>
              <div className="result__text">
                <span className="result__label">
                  {option.label}
                  {mine && <span className="result__mine">Your vote</span>}
                </span>
                <span className="result__pct" aria-label={`${pct} percent, ${plural(option.votes, "vote")}`}>
                  {pct}
                  <span className="result__pct-sign">%</span>
                </span>
              </div>
              <div className="result__track" aria-hidden="true">
                <div className="result__bar" style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
      </ol>
      <p className="results__total">{plural(poll.totalVotes, "vote")}</p>
    </div>
  );
}
