import "./TradeIdeasThinking.css";

export default function TradeIdeasThinking() {
  return (
    <div
      className="trade-ideas-thinking"
      data-testid="trade-ideas-thinking"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="trade-ideas-thinking__visual" aria-hidden="true">
        <span className="trade-ideas-thinking__orbit" />
        <svg className="trade-ideas-thinking__brain" viewBox="0 0 40 40" focusable="false">
          <path d="M20 9c-1-5-8-5-10-1-4-1-7 3-6 7-4 3-3 9 1 11-1 5 3 9 7 8 3 4 8 2 8-2V9Zm0 0c1-5 8-5 10-1 4-1 7 3 6 7 4 3 3 9-1 11 1 5-3 9-7 8-3 4-8 2-8-2" />
          <g className="trade-ideas-thinking__connections">
            <path d="M10 8v6l5 4v7l-4 4M4 15l6 2M5 26l5-3M30 8v6l-5 4v7l4 4M36 15l-6 2M35 26l-5-3" />
          </g>
          <g className="trade-ideas-thinking__nodes">
            <circle cx="15" cy="18" r="1.7" />
            <circle cx="30" cy="23" r="1.7" />
            <circle cx="11" cy="29" r="1.7" />
          </g>
          <g className="trade-ideas-thinking__nodes trade-ideas-thinking__nodes--alternate">
            <circle cx="25" cy="18" r="1.7" />
            <circle cx="10" cy="23" r="1.7" />
            <circle cx="29" cy="29" r="1.7" />
          </g>
        </svg>
      </div>
      <div className="trade-ideas-thinking__copy">
        <p className="trade-ideas-thinking__eyebrow">QUANTBRAIN</p>
        <p className="trade-ideas-thinking__title">Generating trade ideas</p>
        <p className="trade-ideas-thinking__description">
          Your request is in progress. Ideas will appear when the analysis is ready.
        </p>
      </div>
    </div>
  );
}
