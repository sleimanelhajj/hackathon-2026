import { memo } from "react";
import type { Widget } from "../lib/api";
import { useDashboardData } from "../dashboard/DataContext";
import { initials } from "../components/ui";

type Props = { widget: Extract<Widget, { type: "top-people" }> };

export const TopPeopleWidget = memo(function TopPeopleWidget({ widget }: Props) {
  const people = useDashboardData().topPeople.slice(0, widget.limit);
  if (!people.length) return <div className="widget-empty"><p>No one has written to you yet.</p></div>;
  const max = Math.max(1, ...people.map((p) => p.count));
  return (
    <ul className="people">
      {people.map((p) => (
        <li className="person" key={p.email}>
          <span className="avatar" aria-hidden>{initials(p.name)}</span>
          <div style={{ minWidth: 0 }}>
            <p className="person-name" title={p.email}>{p.name}</p>
            <div className="bar-track" aria-hidden><div className="bar-fill" style={{ width: `${(p.count / max) * 100}%` }} /></div>
          </div>
          <span className="num person-count" aria-label={`${p.count} emails`}>{p.count}</span>
        </li>
      ))}
    </ul>
  );
});
