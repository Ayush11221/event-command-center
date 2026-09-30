# Design System Direction

**Status:** Phase 0 strategy, not final visual design  
**Decision point:** Detailed visual choices belong to Phase 2 after the Phase 1 [journeys](USER_JOURNEYS.md), [information architecture](INFORMATION_ARCHITECTURE.md), [screen inventory](SCREEN_INVENTORY.md), and [UX states](UX_STATES.md) are reviewed.

This document defines how design decisions will be made. It intentionally does not select final fonts, colors, spacing, component variants, charts, or branding.

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

**Final font: TBD - to be decided during the dedicated UI/UX design phase.**

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

## 9. Theme strategy

Plan for both light and dark themes from shared semantic tokens. Do not build dark mode by mechanically inverting colors. Each theme must independently satisfy contrast, chart legibility, focus visibility, status differentiation, and comfortable viewing in its expected environment. Exact colors and user/system theme behavior remain TBD.

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
- Exact spacing scale
- Border radius
- Shadows/elevation
- Typography scale
- Dashboard chart library
- Final component variants
- Final responsive breakpoints
- Final visual branding
- Theme selection/persistence behavior
- Dense table and chart accessibility patterns
- Scanner feedback and accessible fallback details

## Design decision workflow

Phase 1 defines journeys, information architecture, content priority, state models, and low-fidelity flows. Phase 2 tests visual directions against representative command-center, scanner, and participant screens; defines tokens and component states; records decisions; and only then authorizes required packages. Every choice should trace to a user task, operational risk, accessibility need, or maintainability benefit.
