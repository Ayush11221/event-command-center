# Design System Direction

**Status:** Phase 2 token and interaction foundation; visual brand/font/palette and implemented components remain open
**Decision point:** This foundation applies the Phase 1 [journeys](USER_JOURNEYS.md), [information architecture](INFORMATION_ARCHITECTURE.md), [screen inventory](SCREEN_INVENTORY.md), and [UX states](UX_STATES.md).

This document fixes semantic roles and provisional numeric token scales so representative screens can be evaluated without claiming a final font, palette, chart library, or brand.

## 1. Design goals

The application should feel professional, modern, operational, trustworthy, fast, consistent, accessible, and information-dense without feeling cluttered. It should look intentionally designed for live event operations rather than like a generic generated dashboard.

The visual system must support two distinct modes without becoming two products:

- Command-center and staff screens prioritize scanability, density, freshness, exceptions, and confident action.
- Participant screens prioritize simplicity, guidance, mobile use, and clear next steps.

## 2. UX principles

- Put current operational state, freshness, and critical exceptions where they can be understood quickly.
- Make critical states visually obvious and explain what action is available.
- Prefer clear hierarchy, alignment, and progressive disclosure over decoration or visual complexity.
- Avoid excessive cards; group information by task and relationship, not by default component shape.
- Use motion only when it explains continuity, feedback, or state change.
- Preserve context during live updates; do not make data jump or animate continuously.
- Make destructive/high-impact actions deliberate and reversible where possible.
- Design loading, empty, stale, offline, partial, error, and permission-denied states as real product states.
- Keep participant flows short and mobile-first; keep staff flows usable on tablet/mobile under time pressure.
- Use plain language and stable status terms that match API/domain concepts.

## 3. UI technology candidates

The intended direction is:

- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Lucide React
- Motion / motion.dev where justified
- Charting library **TBD based on actual visualization and accessibility requirements**
- Figma **optional** for design/prototyping

These candidates are not installed or finalized by this document. Phase 2 must validate bundle impact, maintenance, accessibility, theming, and fit with the actual screen architecture before installation.

## 4. Component strategy

- Use shadcn/ui as a source-level base for accessible primitives, not as a complete product design.
- Create product-specific components when behavior or semantics are unique: scanner status, scan decision feedback, occupancy/capacity status, data freshness, gate health, operational alert, forecast availability, and certificate batch/delivery progress. Certificate issue state must never be visually conflated with email delivery state.
- Do not add a second broad component library without a concrete gap and migration/consistency analysis.
- Keep reusable design tokens separate from one-off styling.
- Keep state names and behavior consistent across features.
- Define loading, error, empty, success, stale, offline/degraded, disabled, and permission-denied behavior for components that need them.
- Prefer composition over giant configurable components and avoid abstractions before repeated behavior exists.

Likely component layers, created only when needed:

- `components/ui`: reviewed shadcn/ui primitives
- `components/common`: cross-feature application components with stable repeated use
- `components/layout`: navigation and structural shells
- `features/*`: domain-specific composition and behavior

## 5. Icon strategy

Lucide React is the preferred direction. Use one consistent icon language, pair unfamiliar/critical icons with text, and provide accessible labels where the icon is interactive or meaningful. Do not introduce another icon library unless a concrete missing symbol or capability justifies the cost.

## 6. Animation strategy

Motion / motion.dev is a candidate for:

- Meaningful page/panel continuity
- Immediate interaction feedback
- State transitions whose direction or cause benefits from motion
- Subtle navigation improvements

Avoid decorative animation everywhere, continuous dashboard motion, animated counters that obscure actual values, long transitions during scanning, or effects that compete with alerts. Respect `prefers-reduced-motion`, preserve focus, and ensure all flows remain understandable with animation disabled.

## 7. Typography

**Final font: TBD.** Until a font is evaluated, use a system sans-serif stack. Use semantic typography roles: display/page title, section title, subsection, body, label/control, helper/caption, and tabular operational numerals. A provisional type scale is 12/14/16/20/24/32 CSS px with 16 px body; exact family, weights and line-height are validated on dense command-center, scanner and mobile participant examples. Use tabular numbers for counts/time/percentages and never make 12 px the default body size.

Evaluation must cover:

- Readability at participant and dense dashboard sizes
- Clear headings and body hierarchy
- Tabular/lining number behavior for occupancy, time, percentages, and charts
- Character distinction and accessibility
- Available weights, performance, licensing, and browser compatibility
- Sensible system-font fallback

No font package should be added before this evaluation.

## 8. Color system

**Final palette: TBD - to be decided during the dedicated UI/UX design phase.**

Required semantic categories are:

- Primary
- Secondary
- Background
- Surface
- Border
- Text
- Muted text
- Success
- Warning
- Error/Danger
- Info

Operational semantics need additional state definitions such as normal, nearing capacity, at/over capacity, stale, offline, unavailable, accepted, rejected, and attention required. These states must combine color with text, icon, pattern, position, or shape. Color alone must never carry the decision.

Semantic tokens are `canvas`, `surface`, `surface-raised`, `surface-inset`, `border`, `text`, `text-muted`, `focus`, `action`, `action-hover`, `action-disabled`, `success`, `warning`, `critical`, `info`, and `unavailable`. Status mappings: accepted/saved = success; capacity near threshold = warning; capacity 100% or policy rejection = critical with different text/shape; stale/unknown = unavailable/neutral, never success; technical scanner failure = distinct error/unknown, not policy rejection. Registration full uses an availability label, not an alert color rule.

Provisional layout tokens: spacing 4/8/12/16/24/32/48 CSS px, with 8 px base rhythm and 4 px fine adjustment; radius 4/8/12 px for controls/panels/dialogs; elevation 0/1/2 for flat surface, raised panel and modal/overlay. Prefer border and spacing over stacked shadows. These scales are a foundation, not a mandate to use every step. Surface hierarchy is canvas → task surface → raised overlay, with one dominant action region and stable event/gate context. Do not tile every metric into a separate card.

## 9. Theme strategy

Slice 3 supports **Light**, **Dark**, and **System** from shared semantic tokens. A user may explicitly select Light or Dark; System follows the operating system color-scheme preference and responds to OS changes while the application is open. The chosen mode is a local browser presentation preference for authenticated and unauthenticated users, not an account field, authorization token, or server-side role setting. Apply the persisted choice (and the current OS preference when System is selected) before application rendering to avoid a wrong-theme flash. Do not build dark mode by mechanically inverting colors. Each rendered theme must independently satisfy contrast, chart legibility, focus visibility, status differentiation, and comfortable viewing in its expected environment. Exact palette values remain TBD for representative-screen evaluation.

For both rendered themes, assign token values independently and test normal text at ≥4.5:1 contrast, large text at ≥3:1, and meaningful UI boundaries/focus/status graphics at ≥3:1 against adjacent colors, consistent with the WCAG 2.2 AA target. All Slice 3 screens, loading/error/empty/success states, and theme controls must work in Light, Dark, and System-derived appearance. There must be no flash that falsely conveys a status. Never use hue alone for alert severity or scan acceptance. No fourth/custom theme mode is required.

## 10. Dashboard visualization strategy

Likely visualization needs include:

- Current occupancy and capacity utilization
- Occupancy over time
- Forecast occupancy with actual values and uncertainty
- Gate traffic over time and by gate
- Check-in rate
- Event capacity thresholds
- Historical event comparisons where data is comparable

Choose a chart library only after defining dataset size, update cadence, interactions, annotation, responsive behavior, accessibility, theming, and export needs. Prefer direct values/tables when a chart does not improve a decision. MVP forecasts must distinguish current occupancy from 30- and 60-minute predictions against the single event capacity, show generation time/freshness and uncertainty, and avoid false precision.

Chart foundation: label observed versus predicted series directly; show horizon, unit, timestamp, capacity reference and uncertainty interval; distinguish stale or missing segments rather than connecting through gaps. Provide an equivalent compact table or text summary for decisions and keyboard/screen-reader access. Keep axes stable during live updates when possible; avoid smooth animation that conceals revisions. Occupancy (INSIDE) and REGISTERED count are separate labeled measures even though both can be compared with the one capacity.

## Component state contract

Buttons/links/inputs need default, hover where applicable, keyboard focus-visible, active, disabled, pending and error states; disabled controls include an explanation when the action is policy-blocked. Forms retain valid input on validation failure and identify field plus summary. Scanner result has accepted, policy-rejected, duplicate, technical/unknown and same-`scan_id` replay presentations; technical/unknown never looks accepted. Data panels have loading, empty, current, stale, partial, unavailable and forbidden states with last-confirmed time. Alerts expose severity **and** ACTIVE/ACKNOWLEDGED/RESOLVED separately. Certificate components show eligibility, issue and delivery as three different lines of state; batch progress shows counts and partial failure. Live announcements are throttled/priority-ranked so repeated updates do not overwhelm assistive technology. Exact visual variants are tested on representative screens before implementation.

## 11. Responsive strategy

### Desktop command center

Optimize for simultaneous operational context, clear hierarchy, stable layout during live updates, and drill-down without losing the event overview.

### Tablet operational screens

Support touch targets, landscape/portrait changes, bright/noisy venue conditions, intermittent connectivity indicators, and quick return to scanning.

### Mobile participant experience

Prioritize event details, registration, QR access, status, and certificate with minimal navigation and readable content.

### Mobile/tablet QR scanning

Design around camera permission, targeting feedback, rapid repeated use, clear accept/reject/unknown states, duplicate/technical distinctions, and connectivity. An accessible capture/recovery alternative is TBD, but it must not become a manual gate override or offline acceptance in MVP. Do not rely on hover.

Final breakpoints must follow content stress tests and target devices, not framework defaults alone.

## 12. Accessibility

- Semantic HTML and correct heading/landmark structure
- Full keyboard operation and logical focus order
- Highly visible focus states
- WCAG 2.2 AA contrast target
- Accessible names, instructions, validation, and error summaries for forms
- Screen-reader announcements for scan results and live updates without excessive interruption
- Reduced-motion support
- Status indicators independent of color
- Touch targets and zoom/reflow appropriate to operational devices
- Text/table alternatives or summaries for important charts
- Focus management for dialogs, route changes, errors, and repeated scan results

Accessibility is part of component acceptance, not a final audit-only activity.

## 13. Design anti-patterns

Explicitly avoid:

- Generic AI-dashboard appearance
- Excessive gradients or glassmorphism
- Decorative UI competing with operational information
- Unnecessary or distracting animation
- Random colors or ungoverned status meanings
- Inconsistent border radius, spacing, shadows, or typography
- Excessive cards and nested containers
- Giant hero sections where they do not serve the product task
- Tiny low-contrast text used to force density
- Dashboards composed only from disconnected KPI tiles
- Charts without decision purpose, units, freshness, or accessible alternatives
- Hiding failures behind optimistic or permanently loading states

## 14. Design decisions still TBD

TBD during the dedicated UI/UX phase:

- Final font
- Final color palette
- Final values/refinement of the provisional spacing, radius, elevation, and typography scales after representative-screen testing
- Dashboard chart library
- Final component variants
- Final responsive breakpoints
- Final visual branding
- Dense table and chart accessibility patterns
- Scanner feedback and accessible fallback details

## Design decision workflow

Phase 1 defines journeys, information architecture, content priority, state models, and low-fidelity flows. Phase 2 documents the foundation; representative command-center, scanner, and participant prototypes must validate final font/palette, token refinements and component variants before packages are authorized. Every choice should trace to a user task, operational risk, accessibility need, or maintainability benefit.
