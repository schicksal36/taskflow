type LogoProps = {
  compact?: boolean;
};

export function Logo({ compact = false }: LogoProps) {
  return (
    <div className="brand-mark" aria-label="JPARTNERS">
      <span className="brand-symbol" aria-hidden="true">
        J
      </span>
      {!compact && (
        <div className="brand-copy">
          <strong>JPARTNERS</strong>
          <small>사내 업무요청 관리 시스템</small>
        </div>
      )}
    </div>
  );
}
