import React from "react";
import { IcX, IcTarget, IcUser, IcPlus, IcSibling } from "./icons";
import wheel from "../src/domain/wheel";
import format from "./format";

const { getSiblings, getSpouses } = wheel;
const { getInitials, formatLifespan } = format;

export function Btn({
  variant = "default",
  full,
  gradient,
  onClick,
  children,
  type = "button",
  ariaLabel,
  disabled = false,
}) {
  const tone = gradient ? "gradient" : variant;
  return (
    <button
      className={`btn btn-${tone}${full ? " btn-full" : ""}`}
      onClick={onClick}
      type={type}
      aria-label={ariaLabel}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function Tag({ outline, children }) {
  return <span className={`tag${outline ? " tag-outline" : ""}`}>{children}</span>;
}

export function Row({ label, value }) {
  return (
    <div className="detail-row">
      <span className="detail-row-label">{label}</span>
      <span className="detail-row-value">{value}</span>
    </div>
  );
}

export function PersonCard({
  person,
  isCenter,
  family,
  onRecenter,
  onSelectPerson,
  onClose,
  onAddPerson,
  canEdit = true,
  database = false,
  inModal = false,
}) {
  if (!person) {
    return (
      <div className="glass scaleIn person-card">
        <div className="person-card-header">
          <div className="person-card-identity">
            <div className="person-avatar person-avatar-unknown">
              <IcUser />
            </div>
            <div>
              <h3 className="fd person-card-name">Unknown Ancestor</h3>
              <p className="person-card-sub">No records found</p>
            </div>
          </div>
          {!inModal && (
            <Btn variant="ghost" onClick={onClose} ariaLabel="Close person details">
              <IcX />
            </Btn>
          )}
        </div>
        <p className="person-card-empty">The threads of this lineage are lost to time.</p>
      </div>
    );
  }

  const initials = getInitials(person.name);
  const avatarTone = person.gender === "F" ? "female" : person.gender === "M" ? "male" : "neutral";
  const sibs = getSiblings(person.id, family);
  const spouses = getSpouses(person.id, family);
  const hasMother = Boolean(person.motherId);
  const hasFather = Boolean(person.fatherId);
  const lifespan = formatLifespan(person.birth, person.death);
  const firstName = person.name.trim().split(/\s+/)[0] || person.name;

  return (
    <div className="glass scaleIn person-card">
      <div className="person-card-header">
        <div className="person-card-identity">
          <div className={`person-avatar person-avatar-${avatarTone} fd`}>{initials}</div>
          <div className="person-card-titles">
            <h3 className="fd person-card-name">{person.name}</h3>
            <div className="person-card-tags">
              <Tag>{{ F: "♀ Female", M: "♂ Male", X: "Non-binary", U: "Unknown" }[person.gender] || "Unknown"}</Tag>
              {lifespan && <Tag outline>{lifespan}</Tag>}
            </div>
          </div>
        </div>
        {!inModal && (
          <Btn variant="ghost" onClick={onClose} ariaLabel="Close person details">
            <IcX />
          </Btn>
        )}
      </div>

      <div className="person-card-details">
        {person.birthplace && <Row label="Birthplace" value={person.birthplace} />}
        {person.occupation && <Row label="Occupation" value={person.occupation} />}
        {spouses.length > 0 && (
          <Row
            label={spouses.length === 1 ? "Spouse" : "Spouses"}
            value={
              <span className="relative-chip-list">
                {spouses.map((s) =>
                  onSelectPerson ? (
                    <button key={s.id} type="button" className="relative-chip" onClick={() => onSelectPerson(s.id)}>
                      {s.name}
                    </button>
                  ) : (
                    <span key={s.id}>{s.name}</span>
                  ),
                )}
              </span>
            }
          />
        )}
        {sibs.length > 0 && (
          <Row
            label="Known siblings"
            value={
              <span className="relative-chip-list">
                {sibs.map((s) =>
                  onSelectPerson ? (
                    <button key={s.id} type="button" className="relative-chip" onClick={() => onSelectPerson(s.id)}>
                      {s.name.split(" ")[0]}
                    </button>
                  ) : (
                    <span key={s.id}>{s.name.split(" ")[0]}</span>
                  ),
                )}
              </span>
            }
          />
        )}
      </div>

      {person.bio && <p className="person-card-bio">{person.bio}</p>}

      <div className="person-card-actions">
        {!isCenter ? (
          <Btn full gradient onClick={() => onRecenter(person.id)}>
            <IcTarget /> Center wheel on {firstName}
          </Btn>
        ) : (
          <p className="person-card-center-note">✨ Currently the center of the lineage</p>
        )}

        {canEdit && (
          <details className="relative-actions">
            <summary>Add relative</summary>
            <div className="relative-actions-grid">
              <Btn variant="outline" onClick={() => onAddPerson(person.id, "sibling")}>
                <IcSibling /> Add Sibling
              </Btn>
              <Btn variant="outline" onClick={() => onAddPerson(person.id, "spouse")}>
                <IcPlus /> Add Spouse
              </Btn>
              <Btn variant="outline" onClick={() => onAddPerson(person.id, "child")}>
                <IcPlus /> Add Child
              </Btn>
              {!hasMother && (
                <Btn variant="outline" onClick={() => onAddPerson(person.id, "mother")}>
                  ♀ Add Mother
                </Btn>
              )}
              {!hasFather && (
                <Btn variant="outline" onClick={() => onAddPerson(person.id, "father")}>
                  ♂ Add Father
                </Btn>
              )}
              {database && (
                <Btn variant="outline" onClick={() => onAddPerson(person.id, "parent")}>
                  Add another parent family
                </Btn>
              )}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
