import { classById, specById } from "./lib/classes.ts";
import { publicAssetUrl } from "./lib/renders.ts";
import type { SavedProfile } from "./lib/types.ts";

export function Lineup({
  profiles,
  onChoose,
  onEnter,
}: {
  profiles: SavedProfile[];
  onChoose: (profile: SavedProfile) => void;
  onEnter: () => void;
}) {
  return (
    <div className="lineup-screen">
      <header className="lineup-bar">
        <div className="brand">
          <span className="brand-name">Bis-ness</span>
          <span className="brand-sub">Casual</span>
        </div>
        <button className="btn" type="button" onClick={onEnter}>
          Enter
        </button>
      </header>
      <h1>The team</h1>
      <p className="fine">Choose who you are planning for.</p>
      <div className="lineup" role="list">
        {profiles.map((profile, index) => {
          const accent = classById(profile.character.classId)?.color ?? "#e4c98a";
          const src = publicAssetUrl(import.meta.env.BASE_URL, profile.renderFile, profile.renderHash);
          const spec = specById(profile.mainSpec).name;
          return (
            <button
              key={`${profile.region}:${profile.slug}`}
              type="button"
              role="listitem"
              className="lineup-card"
              style={{ ["--i" as string]: index, ["--accent" as string]: accent }}
              onClick={() => onChoose(profile)}
            >
              <span className="lineup-figure">
                {src ? (
                  <img src={src} alt="" />
                ) : (
                  <span className="empty">No Armory render</span>
                )}
              </span>
              <strong>
                {profile.character.name} {profile.character.surname}
              </strong>
              <span className="lineup-meta">
                Level {profile.character.level} {profile.character.race} {profile.character.className}
              </span>
              <span className="lineup-spec">{spec}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
