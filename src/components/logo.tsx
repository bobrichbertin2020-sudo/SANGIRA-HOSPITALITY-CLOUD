import Image from "next/image";
import Link from "next/link";

function Mark({ className, priority }: { className: string; priority?: boolean }) {
  return (
    <Image
      alt=""
      aria-hidden="true"
      className={`${className} object-contain`}
      height={512}
      priority={priority}
      src="/logo-mark.png"
      width={512}
    />
  );
}

export function Logo({
  size = "header",
  href,
  priority = false,
}: {
  size?: "header" | "seal";
  href?: string;
  priority?: boolean;
}) {
  if (size === "seal") {
    return (
      <span
        aria-label="Sangira Hospitality Cloud"
        className="inline-flex rounded-[2rem] bg-[#e6ede7] p-2.5 ring-1 ring-[#d3e0d6]"
        role="img"
      >
        <span className="inline-flex rounded-[1.6rem] bg-[#153d32] p-2 shadow-[0_14px_30px_-12px_rgba(21,61,50,0.65)]">
          <span className="inline-flex rounded-[1.25rem] bg-[#f6f1e7] p-3">
            <Mark className="size-20" priority={priority} />
          </span>
        </span>
      </span>
    );
  }

  const content = (
    <>
      <span className="inline-flex shrink-0 rounded-xl bg-[#f6f1e7] p-1 shadow-sm ring-1 ring-[#153d32]/15">
        <Mark className="size-9" priority={priority} />
      </span>
      <span className="flex flex-col leading-none">
        <span className="font-serif text-xl font-semibold tracking-wide text-[#153d32]">Sangira</span>
        <span className="mt-1 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[#a46f38]">
          Hospitality Cloud
        </span>
      </span>
    </>
  );

  return href ? (
    <Link aria-label="Sangira Hospitality Cloud" className="inline-flex items-center gap-3" href={href}>
      {content}
    </Link>
  ) : (
    <span className="inline-flex items-center gap-3">{content}</span>
  );
}
