import { AppShell } from "@/components/AppShell";
import { manualSections } from "@/lib/manual";

export default function ManualPage() {
  const itemCount = manualSections.reduce((sum, section) => sum + section.items.length, 0);

  return (
    <AppShell title="사용설명서" description="TaskFlow 주요 기능 사용 방법을 전체 확인합니다.">
      <section className="panel release-notes-panel">
        <div className="panel-head">
          <h2>전체내역</h2>
          <span>{manualSections.length}분류 / {itemCount}건</span>
        </div>

        <div className="release-notes-list">
          {manualSections.map((section) => (
            <section className="release-note-date-group" key={section.category}>
              <div className="release-note-date-head">
                <h3>{section.category}</h3>
                <span>{section.items.length}건</span>
              </div>

              <div className="release-note-group-items">
                {section.items.map((item) => (
                  <article className="release-note-card" key={`${section.category}-${item.title}`}>
                    <div>
                      <h4>{item.title}</h4>
                      <p>{item.summary}</p>
                    </div>
                    <ul>
                      {item.details.map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
