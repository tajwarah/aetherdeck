// The eye of Horus: the browser's mark, in the same strokes as the app icon (build/icon.svg).
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg className="logo" viewBox="210 260 610 540" width={size} height={size * 0.885} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M236 372 C 340 292, 560 276, 790 344" strokeWidth="40" />
        <path d="M232 508 C 318 396, 500 372, 622 470 L 800 470" strokeWidth="36" />
        <path d="M232 508 C 340 578, 520 588, 622 470" strokeWidth="26" />
        <path d="M566 572 C 610 640, 690 660, 742 626 C 784 596, 754 544, 712 566 C 688 580, 698 612, 722 606" strokeWidth="28" />
      </g>
      <path d="M398 574 L 470 590 L 400 776 C 392 794, 366 788, 368 768 Z" fill="currentColor" />
      <path d="M434 396 a74 74 0 1 0 .01 0 Z M434 432 a38 38 0 1 1 -.01 0 Z" fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
