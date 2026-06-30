import { AppShell } from "@/components/AppShell";
import { releaseNotes } from "@/lib/releaseNotes";

export default function ReleaseNotesPage() {
  return (
    <AppShell title="릴리즈노트" description="TaskFlow에 반영된 기능 변경 내역을 전체 확인합니다.">
      <section className="panel release-notes-panel">
        <div className="panel-head">
          <h2>전체내역</h2>
          <span>{releaseNotes.length}건</span>
        </div>

        <div className="release-notes-list">
          {releaseNotes.map((note) => (
            <article className="release-note-card" key={`${note.date}-${note.title}`}>
              <div>
                <span>{note.date}</span>
                <h3>{note.title}</h3>
                <p>{note.summary}</p>
              </div>
              <ul>
                {note.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
