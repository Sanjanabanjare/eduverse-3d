# EduVerse 3D — Privacy, Legal, Accessibility & Product Trust Audit

**Review date:** 1 November 2026  
**Scope:** Read-only source and configuration review of the local prototype. This report does not certify legal compliance, perform a penetration test, or represent legal advice. Runtime browser/network and assistive-technology tests were not performed in this pass.

## Executive summary

EduVerse 3D is an educational prototype, not yet a verified commercial service. It handles account identifiers, optional contact/profile details, and extensive learning records in a local JSON store. It uses a first-party session cookie, browser storage for selected preferences and some activity data, Google Fonts, and externally hosted Unsplash course images. No analytics, advertising pixel, marketing SDK, hosted AI provider, payment processor, or embedded video/map/chat service was found in the reviewed source.

The repository already contains draft Terms and Privacy pages that disclose important prototype limits. They explicitly say they are drafts and should not be treated as finalized legal notices. Operator identity, deployment jurisdictions, contact/grievance route, retention schedule, processors, and actual production hosting remain **Not yet decided**. No cookie or refund page exists. A cookie banner is not automatically justified by the source inventory; the first-party session cookie appears necessary for authentication, while external font/image requests require a factual third-party disclosure assessment. Runtime cookie behavior of those providers was not tested.

Accessibility foundations exist (semantic labels in some forms, live regions in some messages, Escape-to-close for the modal, some explicit focus styles, reduced-motion handling for one experiment). There is not enough evidence to claim WCAG 2.2 AA conformance. Several concrete content and interaction gaps are visible in source, including placeholder `href="#"` links, an unlabeled Nova input, hard-coded learner/progress content in initial HTML, and incomplete modal focus management evidence.

**Release assessment:** Not ready to represent as a legally finalized, privacy-reviewed, or WCAG-conformant commercial product. The next step is to resolve the factual questions below, then approve targeted implementation and professional legal/accessibility review.

## Scope and evidence limits

- Read `CLAUDE.md`, `PRODUCTION_READINESS.md`, `index.html`, `app.js`, `styles.css`, `backend/server.js`, `privacy.html`, `terms.html`, and `package.json`; searched the project sources for storage, cookie, tracker, embed, image, form, accessibility, and external-host references.
- No account store (`backend/data/store.json`) was opened or copied.
- No user-facing policy text was promoted to final status. No application behavior was changed for this audit.
- The local prototype may be run with different environment settings or proxies. Findings describe repository behavior and do not prove production runtime behavior.
- No full image-by-image visual inspection, browser devtools request capture, keyboard-only end-to-end test, screen-reader test, contrast calculation, automated accessibility scan, or legal opinion was performed.

## 1. Legal pages and business policies

| Requirement | Status | Verified implementation / gap | Priority |
|---|---|---|---|
| Privacy notice | **Needs Improvement / Requires Legal Review** | `/privacy.html` is served by the Node static allowlist and documents account and learning data, local JSON storage, camera processing, external Fonts/Unsplash, no analytics, and known limits. It lacks verified operator identity, deployment location, privacy contact, itemized purpose/retention matrix, processor contracts, finalized rights/grievance process, and deployment-specific deletion behavior. It is conspicuously marked as a draft. | P0 before real learner data or public launch |
| Terms | **Needs Improvement / Requires Legal Review** | `/terms.html` is a prototype draft. It describes acceptable use, accounts, learning records, camera use, prototype availability, and deletion limits. Operator, jurisdiction, effective date, service commitments, and dispute process are undecided; it is not final. | P0 before public launch |
| Cookie policy | **Missing** | No cookie policy route/page was found. Source shows the server-issued `eduverse_session` cookie with `HttpOnly`, `SameSite=Lax`, `Path=/`, expiry, and `Secure` only in production. No client-readable cookie code was found. | P1 after deployment/runtime inventory |
| Cookie consent | **Unable to Verify / Requires Legal Review** | Source inventory shows only the authentication session cookie plus third-party font/image requests; no analytics/ad trackers found. Whether any provider or hosting layer adds cookies and what consent/disclosure is required depends on actual deployment, audience, and jurisdictions. Do not add a banner mechanically; capture network behavior and obtain jurisdiction-specific review first. | P0 decision before launch |
| Refund policy | **Not Applicable to current source; recheck before release** | No checkout, pricing/subscription flow, payment SDK, or payment API was found in project source. A refund policy is not supported by present functionality. Reassess if monetization is added. | Reassess on payment feature |

## 2. Tracker, storage and external-request inventory

### Third-party request inventory

| Tracker / service | Purpose | Data likely exposed by the browser request | Provider | Consent / disclosure assessment |
|---|---|---|---|---|
| Google Fonts CSS and font files | Typography | Request IP address, user agent, requested font resource and network metadata | Google | No analytics/ad tracker found. External request is confirmed in `index.html`; evaluate applicable notice/consent duties and consider self-hosting fonts after license verification. Runtime cookies and exact request behavior not tested. |
| Unsplash-hosted course cover images | Course-card imagery | Request IP address, user agent, requested image URL and network metadata | Unsplash | External asset requests are confirmed in `app.js` and `styles.css`; no tracking SDK is present in source. Verify image provenance/license and deployment consent/disclosure implications. Runtime cookies not tested. |
| Analytics, ad pixels, session replay, heatmaps, marketing SDK | None found in reviewed sources | — | — | No consent-gated analytics or advertising integration is configured in the repository. Re-scan deployed page and network traffic before release. |
| Hosted AI, video/map/social embeds, live chat | None found in reviewed sources | — | — | Nova is described in source as guided/rule-based; webcam processing calls loopback OpenCV. No third-party iframe/embed found in `index.html`. |

### Cookie and browser-storage inventory

| Storage | Keys / contents | Purpose and concern |
|---|---|---|
| First-party server cookie | `eduverse_session` | Authentication session; HttpOnly, SameSite=Lax; Secure in production; server-side session table in process memory. Necessary to sign in. Session termination and restart behavior are described in `CLAUDE.md`. |
| `sessionStorage` | Pending idempotency request keys; `eduverse-profile-prompt-dismissed` | Tab/session retry tracking and dismissing the profile completion prompt. Request keys may persist for the tab session until success or tab close. |
| `localStorage` | `eduverse-class-board`, `eduverse-cv-gesture-samples`, `eduverse-feedback`, `eduverse-lesson-note`, `eduverse-low-performance`, `eduverse-note`, `eduverse-reading-list`, `eduverse-theme`, `eduverse-vision-progress`, `eduverse-community`, plus generated `eduverse-*` flags | Preferences and some activity/content can remain on the device after sign-out. Determine which keys may contain personal or learner-generated information and implement account-aware cleanup/retention only after behavior is traced and approved. Shared-device cross-account exposure is a concern. |
| Other browser storage | `eduverse-webcam-drawing.png` appears as a filename/key candidate in source search | Confirm exact API and whether image data is persisted; do not infer from the identifier alone. |

No `document.cookie` use was found. There is no evidence of a consent preference store because optional trackers are not configured. External providers may still receive network metadata even without cookies.

## 3. Data minimization and lifecycle

### Data observed in implementation/documentation

Account and learning data described by the source includes name, username, scrypt password hash, optional email and phone, age, workspace/institution, role/status, sessions, enrollments, lesson progress, assignment content/submissions, attendance, notes, notifications, feedback, vision activity/assignments, and administrator/audit records. Camera frames are sent to the local OpenCV service after explicit user action; code and draft notice state they are not intended to be saved as learning records.

| Data area | Purpose evidenced in product | Minimization / lifecycle gap |
|---|---|---|
| Name and username | Account identity and role-specific workspace | Requiredness and whether full name is necessary should be confirmed for the deployment. |
| Password | Account authentication | Server stores scrypt hash, not plaintext. Establish credential retention, password recovery and deletion behavior. |
| Email and phone | Optional profile completion/contact | User asked that contact details be filled after login; no verified delivery provider exists. Confirm purpose and whether both are needed. Email is not verified in current application. |
| Age | Profile/school context | Could indicate a child; exact age threshold and school/minor operating model are unresolved. Collect only if a documented purpose requires it. |
| Institution/workspace, role/status | Access and class membership | Needed for role/workspace behavior, but operator/controller responsibilities and tenant model are undecided. |
| Attendance, assignments, progress, notes, vision activity | Teaching and learning workflows | Potentially sensitive educational records. Retention, teacher/admin access, export/deletion scope and school instructions are not fully established. |
| Feedback and Nova conversations | Support and guided learning | Confirm content retention, who can read it, and whether it contains student personal data. No hosted AI is active. |
| Camera frames | Live drawing/gesture/lab interactions | Opt-in and local processing are positive controls. Verify no frame capture persists in browser caches/logs and document the local service boundary. |

No data retention period is documented in code or legal pages. Account deletion exists, but relationship-by-relationship erasure and legal retention exceptions have not been verified. Avoid adding analytics or collecting extra profile data before purpose, access, and deletion are documented.

## 4. India DPDP framework: gap assessment

The official Gazette notification appoints phased commencement for the DPDP Act: selected sections took effect on publication; section 6(9) and section 27(1)(d) take effect one year after Gazette publication; and the principal group (including sections 3–17 and others listed in the notification) takes effect eighteen months after publication. The notification is dated 13 November 2025 and was published in the Gazette on 14 November 2025. The notified Rules state that Rules 1, 2 and 17–21 took effect on publication, Rule 4 takes effect one year after publication, and Rules 3, 5–16, 22 and 23 take effect eighteen months after publication. As of this review date (1 November 2026), the one-year tranches are due around 14 November 2026 and the main eighteen-month tranches around 14 May 2027. Confirm all dates and the effect of the corrigendum against official Gazette documents before launch. This report is not a legal opinion.

| Topic | Status | Gap / action |
|---|---|---|
| Applicability and role | **Requires Legal Review** | Likely processing of digital personal data is evident. Whether the operating entity is a Data Fiduciary, a school is the Data Fiduciary, or EduVerse acts as processor depends on actual contracts and deployment; identity and role are Not yet decided. |
| Notice, purpose and consent | **Needs Improvement** | Prototype Privacy page is a draft and lacks verified operator, granular purposes, contact and deployed service-provider facts. Registration acknowledges a Terms and Privacy summary; it is not evidence of a complete production notice/consent process. |
| Purpose limitation / minimization | **Needs Improvement** | Multiple profile and educational fields are collected or supported; a field-to-purpose decision and required/optional distinction are not documented. |
| Accuracy and correction | **Partial** | Profile update exists, but data-subject correction process and correction of derived/teacher-entered records are not fully established. |
| Security safeguards | **Partial** | Password hashing, role checks, HttpOnly cookie, local restrictions, and other controls exist. JSON-file persistence, in-memory sessions/limits, demo verification, and no configured backup/production operations leave material risk. See `PRODUCTION_READINESS.md`. |
| Breach response | **Missing / Requires Legal Review** | No incident response procedure, notification workflow, responsible contact, or tested breach handling was found. Align timing/recipients with applicable provisions and rules in force. |
| Retention and erasure | **Missing** | No defined schedule. Account deletion exists but complete downstream record handling is unverified. Local browser data may outlive sign-out. |
| User rights and grievance | **Needs Improvement** | Current draft says contact school/workspace administrator, but no verified operator/privacy contact, grievance officer, response times, or rights workflow is configured. |
| Processor/vendor arrangements | **Unable to Verify** | Google Fonts and Unsplash are referenced; no production hosting/vendor or processor contracts were found in source. Confirm contracts, subprocessors, processing locations and instructions. |
| Cross-border processing | **Unable to Verify** | Local prototype does not establish where future production data or third-party requests are processed. Determine hosting and transfer implications from current official rules and notifications. |
| Children’s data | **Requires Legal Review / High priority** | Product is school-oriented and includes age field; likely use by children must be assessed. Verify age handling, parental/guardian consent duties, exemptions and school arrangements under currently commenced law/rules. |
| Significant Data Fiduciary | **Not yet decided** | No evidence that EduVerse has been designated or meets criteria; assess only after business scale, processing and official designation are known. |

### Qualified Indian privacy counsel should decide

1. The Data Fiduciary/processor roles among product operator, school/workspace, hosting providers and other vendors.
2. Applicability and phased commencement for each relevant Act/Rule section as of deployment date, including any later notification/corrigendum.
3. Child-user thresholds, parental consent, school-related exceptions and age-appropriate notice/consent workflow.
4. Required content and form of notice, consent withdrawal, grievance contact, rights handling and retention/erasure exceptions.
5. Breach notification duties/timing and recordkeeping for the actual architecture.
6. Vendor terms, international processing, security safeguards and whether any sector-specific education requirements apply.

Official sources:

- [MeitY — DPDP Act commencement notification G.S.R. 843(E)](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf).
- [MeitY — Digital Personal Data Protection Rules 2025 and corrigendum listing](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digital-Personal-Data-Protection-Rules-2025%3B) (Rules published 14 November 2025; corrigendum listed 16 December 2025).
- [MeitY — notified DPDP Rules Gazette G.S.R. 846(E)](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf).
- [MeitY — DPDP Rules corrigendum G.S.R. 892(E)](https://www.meity.gov.in/static/uploads/2025/12/3c7ebbae0e5456f493f486e6845df86b.pdf).
- [MeitY — DPDP Act 2023 PDF](https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf).
- [MeitY — DPDP Act page](https://www.meity.gov.in/digital-personal-data-protection-act).

## 5. Accessibility review (WCAG 2.2 AA target)

This is a source review, not a conformance evaluation. Status is **Unable to Verify** unless a source-level issue or implementation is directly evident.

| Criterion / concern | Status | Evidence and recommended action |
|---|---|---|
| Semantic structure and language | **Partial** | Main shell contains headings, sections, buttons and form labels; confirm every dynamically rendered screen has one logical main heading/landmarks and correct document language. |
| Images and alternatives | **Needs Improvement** | No static `<img>` element was found in `index.html`; course covers are CSS background images from Unsplash. Some are decorative, but any meaningful image needs text equivalent in nearby content or accessible name. Maintain an asset/source/license register. Dynamic/modal image use requires runtime review. |
| Form labels | **Needs Improvement** | Auth forms use labels; the static Nova message input is placeholder-only and lacks a programmatic label. Dynamic forms include a mixture of explicit labels and placeholder-only controls; audit each rendered state. |
| Validation and announcements | **Partial** | Some status text uses `aria-live`; confirm errors associate to inputs via `aria-describedby`, focus the first invalid field, and remain announced for all auth/admin/teacher/student forms. |
| Keyboard and focus | **Unable to Verify** | Some `:focus-visible` rules exist, but broad coverage is not shown; only a subset of experiment selectors has an explicit focus style. Test all navigation, camera fallback, dynamic controls, forms and dialogs using keyboard only. |
| Dialogs | **Needs Improvement** | Modal has `role=dialog`, `aria-modal=true`, and labelled title, and closes on Escape. Source review did not establish focus trap, focus restoration, background inertness, or initial focus. Add/test these as a unit. |
| Motion | **Needs Improvement** | Reduced-motion override is present for `.hp-stage` transitions only. Review all animations, canvas loops and transitions against `prefers-reduced-motion`; provide pause/disable controls for prolonged motion where needed. |
| Contrast and typography | **Unable to Verify** | No contrast calculations were run. Multiple role themes and muted text need WCAG contrast checks, including hover/focus/error states and colored status cards. |
| Clear link/action behavior | **Needs Improvement** | Initial HTML includes `href="#"` links (“How it works”, “Explore circles”) with no evidence of completed destination. Wire them to real content or render non-link text until implemented. |
| Accessible names | **Partial** | Several icon-only controls have aria-labels; inspect dynamic icon buttons, canvas controls, close/show controls and notification indicators for accurate names/state. |
| Responsive/zoom | **Unable to Verify** | Responsive styles exist, but 200% zoom, reflow at 320 CSS px, orientation and mobile keyboard workflows were not tested. |

### Minimum verification before an accessibility claim

- Keyboard-only walk through signup, login, logout, profile completion, class/assignment tasks, admin workflows, Nova, and all dialogs.
- Screen-reader review of primary flows with at least one desktop and one mobile screen reader where available.
- Automated scan as a supplement, not a substitute; fix all confirmed issues and manually verify.
- Contrast measurements for every role/theme and all interaction/error states.
- Zoom/reflow checks at 200% and 320 CSS px, reduced-motion check, and camera alternatives.

## 6. Brand credibility, commercial content and IP

| Area | Status | Finding |
|---|---|---|
| Unsupported performance/customer claims | **Needs Improvement** | Initial dashboard has static learner identity and fixed progress values (e.g., 42%, 88%, 48%, 24%) in `index.html`, and profile markup has hard-coded example identity/metrics in `app.js`. These can look like actual user-specific results before live data replaces them. Mark as demo/sample or render neutral loading/empty states; confirm behavior after auth. |
| Business/operator identity | **Missing / Not yet decided** | Brand name is present; legal entity, address, business email, support contacts and operating jurisdiction were not established. Do not invent these in policy pages. |
| Pricing, offers, partnerships, testimonials | **Not Applicable to current source / verify deployed content** | No payment/pricing workflow or evidenced partner/testimonial system was found in reviewed project files. There is no refund policy basis today. |
| Navigation and unfinished interactions | **Needs Improvement** | Placeholder `href="#"` links identified above; source also contains static demo copy and dashboard example metrics. Verify every visible button/link in browser before commercial release. |
| Copyright and asset provenance | **Needs Improvement** | `LICENSES/` contains a third-party MIT notice for a live-camera sketching component. Google Fonts and Unsplash references are present, but the repository does not record exact font/image license, image author/source attribution, or commercial-use evidence. Build a complete asset register and verify licenses/terms. Do not infer that online availability grants commercial reuse. |
| Product name / third-party marks | **Unable to Verify** | No trademark clearance or ownership evidence was available. Obtain a name/mark review before commercial launch if needed. |

### Initial asset register

| Asset class | Source observed | License / rights status |
|---|---|---|
| Live camera sketching component | `LICENSES/` MIT text | License file exists; verify scope matches exact bundled code and keep required notice. |
| DM Sans / Space Grotesk | Google Fonts CSS referenced in `index.html` | **Unable to Verify in this audit**; record font project license/version and choose self-hosting or live loading after privacy review. |
| Course cover photos | Unsplash image URLs constructed in `app.js`/`styles.css` | Exact asset IDs are embedded in source, but author, license snapshot, attribution expectations and commercial use were not independently verified. Record each asset and retain evidence or replace after design review. |
| CSS/Unicode icons and illustrations | Inline characters, CSS artwork, canvas diagrams | Mostly project-authored/system glyphs appear to be used; verify any derived third-party artwork/icon code and platform rendering. |

## 7. Additional risks

- Profile and learning values may look real before account data is loaded; hard-coded sample identity is a trust and privacy concern.
- Local browser activity data may survive sign-out and be visible to another person using the same browser profile. Assess account-specific cleanup without deleting user-created content unexpectedly.
- The interface says “Your learning data is yours. You can review or reset it anytime,” while complete export/reset/deletion coverage is not yet verified. Validate this claim or make the scope precise.
- Camera processing is local to loopback by design. Verify that production deployment does not silently route frames to a remote service and document camera permission behavior.
- `Referrer-Policy: no-referrer` is configured on Node responses, which reduces URL referrer leakage; it does not prevent third parties receiving IP/network metadata for font/image requests.
- User-generated content access, school policies, educational record retention, account role, and child protection require deployment-level governance not represented by generic legal pages.
- Product is single-process local JSON, with no configured production hosting, backups, processor terms or incident-response operations (see `PRODUCTION_READINESS.md`).

## 8. Prioritized implementation roadmap

### P0 — resolve before production or real student data

1. Identify legal operator, Data Fiduciary/processor roles, intended jurisdictions, school/minor use, hosting, support/privacy contact, and any school agreements.
2. Obtain Indian privacy counsel review of DPDP applicability, phased provisions, children’s data, notice/consent, grievance, retention, rights, breach response and vendor/cross-border arrangements.
3. Define data inventory, specific purpose, access matrix and retention/deletion schedule for each user and learning-data category; verify account deletion and local-storage behavior.
4. Replace static demo identity/metrics with clearly labelled sample data or real authenticated values; remove claims that imply reset/export control until verified.
5. Perform a production browser request/cookie capture and third-party asset review; decide whether to self-host fonts/images and whether any consent mechanism is legally required.
6. Establish secure production storage, backups, incident response, provider contracts and deployment safeguards as described in `PRODUCTION_READINESS.md`.

### P1 — accessibility and user trust

1. Add a proper programmatic label to Nova input and audit every dynamic form label/error association.
2. Complete dialog focus trap, initial focus, background interaction isolation, and focus restoration; verify with keyboard and screen reader.
3. Replace or implement placeholder links; audit visible actions against real route behavior.
4. Measure WCAG contrast for all roles and states; expand focus-visible and reduced-motion behavior.
5. Create a tested account-specific browser-storage cleanup/export/reset policy.
6. Build an image/font/third-party asset rights register with version/source/license evidence.

### P2 — before commercial presentation

1. Finalize privacy notice and terms only after facts are verified and counsel reviews them.
2. Add a cookie notice/policy only after confirming the deployed cookie/tracker inventory and applicable obligations.
3. Reassess refund/cancellation policy when a payment or subscription feature is introduced.
4. Review brand name, business identity, support route and demo/example copy; test every route and action.
5. Run a full manual WCAG 2.2 AA assessment and correct all confirmed barriers before making a conformance claim.

## 9. Facts needed to finalize policies (do not guess)

- Legal entity/operator name, business contact and privacy/grievance contact.
- Where the service is operated and where it will be offered.
- Whether deployment is self-hosted by a school, hosted by EduVerse, or both; hosting and database provider/location.
- Whether children under 18 can use it, age-verification approach, and parent/school consent model.
- Data retention periods and the records that must be retained after account deletion.
- Actual vendors/processors, contracts, subprocessors and international data access.
- Support and rights-request process, response times, breach contact/escalation.
- Commercial model, pricing, payment provider, cancellation/refund practice if monetization is planned.
- Provenance/license records for all external images, fonts, icons and code.

## 10. Final status

This report is a source-based audit and prioritized roadmap. It does not certify legal compliance, WCAG conformance, safe production operation, complete rights handling, or complete asset licensing. Application code and legal pages were not changed in this pass. The existing `privacy.html` and `terms.html` remain clearly marked draft notices pending verified operator/business facts and qualified legal review.
