import Image from "next/image";
import Link from "next/link";

export function Brand({ compact = false, href = "/dashboard" }: { compact?: boolean; href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-3">
      <Image
        src="/brand/miracle-dark.png"
        alt="Miracle Software Systems"
        width={132}
        height={32}
        className="h-8 w-auto"
        priority
      />
      {!compact && (
        <span className="border-l border-base-300 pl-3 text-sm font-semibold tracking-wide text-secondary">
          STACK AI
        </span>
      )}
    </Link>
  );
}

export function BrandOnDark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <Image
        src="/brand/miracle-light.png"
        alt="Miracle Software Systems"
        width={160}
        height={40}
        className="h-9 w-auto"
        priority
      />
      {!compact && (
        <span className="border-l border-white/30 pl-3 text-sm font-semibold tracking-wide text-white/90">
          STACK AI
        </span>
      )}
    </div>
  );
}
