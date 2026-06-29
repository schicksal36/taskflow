type StatCardProps = {
  label: string;
  value: number | string;
  helper?: string;
  tone?: "blue" | "green" | "orange" | "red" | "purple";
};

export function StatCard({ label, value, helper, tone = "blue" }: StatCardProps) {
  return (
    <article className="stat-card" data-tone={tone}>
      <span className="stat-icon" aria-hidden="true" />
      <div>
        <p>{label}</p>
        <strong>
          {value}
          {typeof value === "number" && <small>건</small>}
        </strong>
        {helper && <span>{helper}</span>}
      </div>
    </article>
  );
}
