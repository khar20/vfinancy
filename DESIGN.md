# DESIGN.md — vfinancy Visual Design System & Standards

## Document Overview

This document defines the extracted design language, UI patterns, spatial metrics, typography rules, color palettes, and visual paradigms derived from `sample.html` for **vfinancy ERP (Import & Sales Enterprise Suite)**. It serves as the definitive visual and UX baseline to guide designers and developers building future enterprise modules (e.g., Inventory Management, Sales & Invoicing, Import Tracking, Customer CRM, and Reporting Views).

---

## 1. Design System Foundations & Layout Architecture

### 1.1 Visual Philosophy: Industrial Neo-Brutalist Utility

The core aesthetic of the ERP application prioritizes **immediate data clarity**, **high-contrast visual hierarchy**, **zero visual distraction**, and **dense information scannability**.

- **Hard Geometry (Zero Border Radius):** The defining aesthetic rule across the system is an absolute `border-radius: 0px !important;` applied across every interface element—including buttons, cards, drop-down menus, inputs, badges, and avatars.
- **High-Contrast Framing:** Container surfaces, form controls, buttons, and headers are distinctly defined using hard **1.5px** or **2px** solid dark borders.
- **Flat Mechanical Elevation:** Depth is created through crisp offset shadows (`0 2px 0 rgba(0,0,0,0.2)`) rather than soft, ambient blur gradients or rounded elevation vectors.

### 1.2 Application Shell & Layout Grid

The layout utilizes a persistent **two-axis application frame** structured for multi-window desktop and high-density workstation environments:

**Sidebar Navigation Shell (Left Vertical Axis):**

- **Width:** Fixed at **260px** on desktop layouts, collapsible to a high-density **70px** icon-only view on medium screens (<= 800px).
- **Surface:** Deep solid dark background (`#000000` light theme / `#0a0a0a` dark theme) with a **2px solid** right boundary to anchor primary navigation separate from working canvases.
- **Brand Anchor:** Features a prominent top logo block with a square **34x34px** accent yellow box (`#F5C518`) housing bold identity typography.

**Header Bar Shell (Top Horizontal Axis):**

- **Position & Padding:** Fixed top bar with `16px 28px` padding, bounded by a **2px solid** bottom border.
- **Actions Area:** Houses system-wide operational controls (e.g., light/dark theme toggles, tenant switcher, user profile badge).

**Main Working Canvas:**

- **Scroll & Viewport Constraints:** The application viewport is strictly capped at `100vh` height with `overflow: hidden` on the root container. Scrolling is isolated within the internal grid canvas (`max-height: calc(100vh - 73px)`).
- **Grid Layout:** Single column vertical flow containing standard sections: KPI Summary Grid (top), Line/Bar Performance Canvas (middle), and Data Log Table (bottom).

### 1.3 Spatial System & Padding Logic

Spatial relationships follow a strict **4px/8px incremental grid system** to maintain visual alignment across dense screens:

| Token | Value | Application |
|-------|-------|-------------|
| **Micro Spacing** | 3px – 8px | Internal badge padding, icon-to-text gaps (6px to 8px), trend indicator padding |
| **Control & Cell Spacing** | 12px – 14px | Vertical table cell padding (12px), sidebar navigation vertical gaps (12px), button inner padding (4px 12px to 6px 12px) |
| **Container Padding** | 16px – 20px | Internal card padding (18px), section header spacing, data table header gaps (16px 20px) |
| **Canvas Outset Spacing** | 22px – 28px | Outer layout gaps between dashboard cards (22px), grid container outer margins (24px 28px) |

---

## 2. Color Palette & Semantic System

### 2.1 Color Palette Architecture & Theme Modes

The ERP architecture features a robust **dual-theme engine** (Light & Dark) controlled dynamically via root level CSS variables (`[data-theme="dark"]`).

| Color Role | Light Theme Variable / Hex | Dark Theme Variable / Hex | Application & Context |
|------------|---------------------------|---------------------------|----------------------|
| Primary Accent | `--primary-yellow` (#F5C518) | `--primary-yellow` (#F5C518) | Active navigation links, primary action fills, key metric badges, avatar backgrounds |
| Primary Accent Dark | `--primary-yellow-dark` (#D4A800) | `--primary-yellow-dark` (#C9A000) | Hover/active states for primary yellow elements |
| App Canvas BG | `--bg-app` (#F5F5F5) | `--bg-app` (#121212) | Background behind floating working cards and grid panels |
| Surface Panel BG | `--bg-panel` (#FFFFFF) | `--bg-panel` (#1E1E1E) | KPI cards, data tables, header bars, modal surfaces |
| Hover Surface BG | `--bg-hover` (#F0F0F0) | `--bg-hover` (#2E2E2E) | Table header backgrounds, action button hovers, row highlights |
| Input Surface BG | `--bg-input` (#FFFFFF) | `--bg-input` (#2A2A2A) | Text fields, drop-down containers, toggle buttons |
| Primary Border | `--border-color` (#000000) | `--border-color` (#555555) | Main container outlines, table headers, heavy dividers |
| Subtle Divider | `--border-light` (#D0D0D0) | `--border-light` (#444444) | Tabular row dividers, subtle input borders, inner card splits |
| Text Primary | `--text-primary` (#000000) | `--text-primary` (#F5F5F5) | Primary numerical metrics, active titles, table cell body text |
| Text Secondary | `--text-secondary` (#333333) | `--text-secondary` (#DDDDDD) | Table column headers, sub-headings, form label titles |
| Text Muted | `--text-muted` (#555555) | `--text-muted` (#AAAAAA) | KPI category labels, secondary metadata, unit markers |
| Sidebar Canvas | `--sidebar-bg` (#000000) | `--sidebar-bg` (#0A0A0A) | Navigation column background |

### 2.2 Semantic Feedback & Status Color Rules

Functional feedback relies on **high-saturation semantic swatches** to ensure instant operator recognition across multi-table displays:

- **Success / Nominal** (`--success: #71C02B`): Indicates positive revenue trends, completed log synchronizations, active system connections, and stock availability. Pair with `#000000` text on fill.
- **Warning / Action Required** (`--warning: #F5A623`): Indicates system alerts, pending audits, expiring security certificates, or high latency warnings. Pair with `#000000` text on fill.
- **Danger / Critical** (`--danger: #CC3838`): Indicates transaction authentication failures, negative financial variance, system errors, or out-of-stock conditions. Pair with `#FFFFFF` text on fill.

### 2.3 Surface Layering & Structural Contrast

- **Base Surface (Layer 0):** Neutral app canvas (`--bg-app`).
- **Content Surface (Layer 1):** Flat panel cards (`--bg-card`) bounded by a hard `1.5px solid var(--border-color)` line and a `0 2px 0 rgba(0,0,0,0.2)` flat shadow.
- **Interactive Control Surface (Layer 2):** Input boxes and action buttons residing within cards, styled with sharp high-contrast strokes.
- **Active Focus Surface (Layer 3):** Solid yellow fills (`#F5C518`) for active navigation items and primary call-to-action buttons.

---

## 3. Typography & Readability Standards

### 3.1 Typeface Pairings & Roles

The design system implements a **two-font typography architecture** to optimize both header hierarchy and dense table legibility:

- **Headings & Quantitative Figures (Montserrat):** A geometric, high-impact sans-serif utilized for all structural headers (h1–h6), numerical KPI metrics, brand marks, and display titles. Configured with tight tracking (`letter-spacing: -0.02em` to `-0.5px`) and bold weights (600, 700, 800).
- **Body Text, Controls & Data Tables (Figtree):** A clean, highly legible grotesque sans-serif used for tabular data cells, navigation links, form labels, tooltips, and system copy.

### 3.2 Typographic Scale & Formatting Standards

| Typography Role | Font Family | Size (rem / pt) | Weight | Letter Spacing | Case | Visual Style / Rules |
|----------------|-------------|-----------------|--------|----------------|------|---------------------|
| KPI Metric Display | Montserrat | 1.9rem / ~23pt | 800 (Extra Bold) | -0.03em | Standard | High visual priority, line-height: 1.1, bold numerical focus |
| Section Title (H2) | Montserrat | 1.15rem–1.2rem / ~14pt | 700 (Bold) | -0.3px | Title Case | Used for panel titles, section headers, card tops |
| Nav Item Label | Figtree | 0.95rem / ~11.5pt | 500 / 700 (Active) | Normal | Title Case | 500 weight inactive, 700 weight active |
| Table Column Header | Figtree | 0.65rem / ~8pt | 700 (Bold) | +0.6px | UPPERCASE | High scannability, muted secondary text color |
| KPI Meta Label | Figtree | 0.75rem / ~9pt | 600 (Semi Bold) | +0.8px | UPPERCASE | Accompanied by functional status icons |
| Table Body Cell | Figtree | 0.85rem / ~10pt | 400 (Regular) | Normal | Standard | Clean tabular baseline, 1.4 line height |
| Code / Identifier | Figtree / Mono | 0.85rem / ~10pt | 700 (Bold) | Normal | UPPERCASE | Used for transaction IDs (e.g., #TXN-4092) |
| Status Badge Text | Figtree | 0.65rem / ~8pt | 700 (Bold) | +0.3px | UPPERCASE | Compact, inline pill/tag format |

---

## 4. Scalable Component UI Patterns

### 4.1 Data Presentation Components

**KPI Summary Cards:**

- **Structure:** Vertical layout consisting of three internal rows: (1) Muted uppercase category title paired with an icon on the right, (2) Large 1.9rem Montserrat metric display, and (3) Trend indicator pill.
- **Trend Pill Styling:** Compact box featuring a 4px left border accent corresponding to status: Green (`border-left-color: var(--success)`) for growth, Amber for warnings, Red for negative shifts.

**Data Tables:**

- **Header Row:** Fixed top row with dark tint (`var(--bg-hover)`), 1.5px solid black bottom border, and uppercase bold labels.
- **Row Dividers:** Standard 1px solid horizontal lines (`var(--border-light)`) separating body rows, removed on the final row.
- **Action Cell:** Houses compact rectangular action buttons (`.action-btn`) aligned to the right or centered.

**Data Visualization (Charts):**

- **Grid Lines & Axes:** Rendered with light borders (`--border-light`) and tight tick padding.
- **Line Formatting:** Sharp mitered line joins (`borderJoinStyle: 'miter'`), zero curve smoothing (`tension: 0.1`), thick strokes (2px to 3px), and custom point markers with 1.5px dark borders.

### 4.2 Controls & Inputs

**Primary Action Buttons:**

- Background fill in solid primary yellow (`#F5C518`), black text, 1.5px solid black border, bold font weight. Hover state transitions to dark yellow (`#D4A800`).

**Secondary & Table Action Buttons (`.action-btn`):**

- Transparent background, 1.5px solid border (`var(--border-color)`), compact padding (`4px 12px`), 0.7rem bold font size.
- Hover state fills container with primary yellow (`#F5C518`), turning text and borders solid black.

**Theme Toggle Switch:**

- Rectangular control button framed in 1.5px border, combining Font Awesome icon (`fa-moon` / `fa-sun`) with explicit text label.

**Form Inputs (Future Specification):**

- Standardized height (36px–40px), 1.5px solid black border, background white (`--bg-input`), zero border-radius, direct 2px solid black focus indicator on selection.

### 4.3 Navigation & Feedback Patterns

**Sidebar Item States:**

| State | Background | Text | Icon | Left Border |
|-------|-----------|------|------|-------------|
| **Default** | Transparent | #CCCCCC | #F5C518 (yellow) | Transparent 4px |
| **Hover** | rgba(245, 197, 24, 0.15) | #FFFFFF | Yellow | Solid yellow 4px |
| **Active** | #F5C518 (full yellow) | #000000 | Black | Bold white 4px |

**Status Badges (`.status-badge`):**

- Inline rectangular tags with `padding: 3px 10px`, bold 0.65rem uppercase text, and explicit semantic fill colors.

---

## 5. Enterprise UI/UX Guidelines for Future ERP Modules

### 5.1 Information Density & Canvas Management

- **Vertical Workspace Isolation:** Keep page-level scrolling constrained inside dedicated content containers so table headers and page navigation remain persistently visible.
- **Modular Grid Split:** Standardize page layouts into a 4-card top metric summary row, followed by split view panels (e.g., 60% tabular list + 40% master-detail view or graphic breakdown).
- **Progressive Control Density:** Primary action buttons must reside in top section headers. Secondary bulk actions (Export, Filter, Sort) must be consolidated inside tabular toolbar bars directly above column headers.

### 5.2 Form Design & Complex Data Entry

- **Multi-Column Form Grids:** Structured forms (e.g., Invoice Creation, Customs Filing) must use 2-column or 3-column inline field layouts bounded inside framed white cards.
- **Explicit Field Boundaries:** Inputs must never rely on bottom-only underlines or soft grey fills; every input field must feature a full 1.5px solid border.
- **Inline Validation Messages:** Validation feedback must appear directly beneath input containers using `.status-danger` red text and 0.75rem Figtree semi-bold typography.

### 5.3 Accessibility Baselines

- **Color Contrast Ratios:** Text-to-background contrast must maintain a minimum of **7:1** for body copy and **4.5:1** for large metrics, fulfilling WCAG AAA standards.
- **Explicit Focused States:** All interactive controls (buttons, links, form inputs) must feature a high-contrast 2px solid black focus outline when tabbed via keyboard.
- **Non-Color Dependent Indicators:** Status badges and trend indicators must pair color fills with explicit textual labels (e.g., "ÉXITO", "ADVERTENCIA", "CRÍTICO") and icon symbols.

---

## 6. Style Consistency Checklist for Expansion

| Component / Visual Area | Mandatory Pattern (DO) | Banned Anti-Pattern (DON'T) |
|------------------------|------------------------|----------------------------|
| **Border Radius** | Enforce `border-radius: 0px !important;` on all UI elements | Never use rounded corners (e.g., 4px, 8px, 50%, pill) |
| **Borders & Framing** | Apply hard 1.5px or 2px solid dark borders (`--border-color`) | Do not leave containers borderless or defined solely by soft shadows |
| **Shadows & Depth** | Use flat mechanical offset shadows: `0 2px 0 rgba(0,0,0,0.2)` | Avoid soft, multi-layered ambient drop shadows or heavy blur effects |
| **Color Palettes** | Restrict accent fills to Primary Yellow (#F5C518) and semantic swatches | Do not introduce unsanctioned pastels, neon gradients, or primary blues |
| **Typography Hierarchy** | Pair Montserrat (Headings/Metrics) with Figtree (Data/Labels) | Avoid mixing mono fonts for standard text or using generic system fonts |
| **Table Formatting** | Use uppercase bold TH headers, monospace bold IDs, and explicit badges | Do not use sentence case table headers or unstyled text status columns |
| **Active Nav Items** | Apply full yellow background fill (#F5C518) with a 4px solid #fff left bar | Do not rely solely on subtle text color changes for selected routes |

---

## 7. Layout Hierarchy: One Bounding Surface per Content Zone

Nesting rule: a content zone holds exactly **one** bounding surface (bordered panel, card, or datatable). A container may never render inside another container of equal or greater frame weight.

**Banned anti-patterns**

- Card inside card, section inside section, or `Section` wrapping a `DataTable` (the table already provides the frame).
- `Section` used as a generic wrapper on list pages merely to "hold" a table.

**Mandatory pattern**

- List blocks: `<Section flat>` (title, no frame) directly above a `<DataTable>`. The table is the single bounding surface; the gap below the title (14px) plus the table's hard top border supply the separators. Use the `flat` prop on `Section` — never restyle via ad-hoc classes.
- Section separation between stacked blocks relies on **vertical whitespace** (page container gap: 22px; block gap: 14px) and **hairline dividers** (`--border-light`, 1px), never nested boxes.
- Form-card archetypes may keep bordered `Section`/`Card` where the frame is the container itself (e.g. Settings forms).
- Toolbar controls (search, select, filters) keep their individual 1.5px borders (DESIGN.md §5.2) but are never themselves framed by an extra box; only the toolbar's bottom hairline and the table's frame bound them.

**Spacing tokens for section separation**

| Separation | Value |
|------------|-------|
| Page container gap | 22px |
| Section-internal gap | 14px |
| Hairlines (`--border-light`) | 1px |
| Frames (`--border-color`) | 1.5px |
