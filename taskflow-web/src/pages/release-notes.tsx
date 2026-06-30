import { AppShell } from "@/components/AppShell";
import { groupReleaseNotesByDate, releaseNotes } from "@/lib/releaseNotes";

export default function ReleaseNotesPage() {
  const releaseNoteGroups = groupReleaseNotesByDate(releaseNotes);

  return (
    <AppShell title="릴리즈노트" description="TaskFlow에 반영된 기능 변경 내역을 전체 확인합니다.">
      <section className="panel release-notes-panel">
        <div className="panel-head">
          <h2>전체내역</h2>
          <span>{releaseNoteGroups.length}일 / {releaseNotes.length}건</span>
        </div>

        <div className="release-notes-list">
          {releaseNoteGroups.map((group) => (
            <section className="release-note-date-group" key={group.date}>
              <div className="release-note-date-head">
                <h3>{group.date}</h3>
                <span>{group.notes.length}건</span>
              </div>

              <div className="release-note-group-items">
                {group.notes.map((note) => (
                  <article className="release-note-card" key={`${note.date}-${note.title}`}>
                    <div>
                      <h4>{note.title}</h4>
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
          ))}
        </div>
      </section>
    </AppShell>
  );
}
