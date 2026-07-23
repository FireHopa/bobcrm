type MetricCardProps = {
  label: string;
  value: number;
  accent: "blue" | "green" | "yellow" | "red" | "gray";
  helper?: string;
  footnote?: string;
};

export function MetricCard({ label, value, accent, helper = "", footnote = "" }: MetricCardProps) {
  return (
    <article className={`metricCard metricCard-${accent}`}>
      <div className="metricCardTop">
        <span className={`metricAccent metricAccent-${accent}`} />
        {helper ? <span className="metricHelper">{helper}</span> : null}
      </div>

      <p>{label}</p>
      <strong>{value}</strong>
      {footnote ? <small>{footnote}</small> : null}
    </article>
  );
}
