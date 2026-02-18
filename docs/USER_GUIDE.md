# User Guide

## Getting Started

### 1. Create an Account

1. Open the application at `http://localhost:5173`
2. Click **Sign up** on the login page
3. Enter your email, password (8+ characters), and display name
4. Click **Register** to create your account

### 2. Sign In

1. Enter your email and password
2. Click **Sign in**
3. You'll be redirected to the project list

---

## Projects

### Creating a Project

1. Click **New Project** on the project list page
2. Enter a project name and optional description
3. (Optional) Type an address to set the project location — the autocomplete will suggest matching addresses
4. Click **Create**

### Project Detail Page

The project detail page shows:
- **Upload Documents** — drag and drop or click to upload files
- **Documents** — list of uploaded files with processing status
- **Buildings** — list of buildings (auto-extracted or manually added)
- **Project Details** sidebar — status, dates, counts
- **Activity Feed** — recent actions by collaborators

### Deleting a Project

Click the trash icon on the project card in the list view. This permanently deletes the project and all associated data.

---

## Document Processing

### Supported File Types

| Format | Extensions | What Gets Extracted |
|--------|-----------|-------------------|
| PDF | `.pdf` | Text, images (rendered at 300 DPI), page classification |
| Images | `.jpg`, `.jpeg`, `.png`, `.tiff` | Edge detection, line detection, OCR text |
| CAD | `.dxf` | Layers, polylines (footprints), dimensions |
| Spreadsheets | `.xlsx`, `.csv` | Coordinates, dimensions, building data |
| GeoJSON | `.geojson` | Polygon footprints, properties |

### Processing Pipeline

1. **Upload** — File is stored in object storage (MinIO/S3)
2. **Extract** — File type router extracts text, images, and coordinates
3. **Classify** — PDF pages are classified as floor plans, elevations, schedules, or text
4. **Interpret** — Claude AI analyzes architectural drawings to extract building dimensions
5. **Generate** — 3D models (GLB) are generated with multiple LOD levels
6. **Complete** — Buildings appear in the project with 3D models ready

Processing status is shown with badges:
- **Pending** — Queued for processing
- **Processing** — AI analysis and 3D generation in progress
- **Completed** — Buildings extracted successfully
- **Failed** — Processing error (check document details)

### Manual Building Entry

Click **Add Building** to manually enter building data:
- Name, height, floor count, floor height
- Roof type (flat, gabled, hipped)
- Construction phase assignment

---

## 3D Viewer

### Opening the Viewer

Click **Open 3D Viewer** from the project detail page to enter the full-screen 3D visualization.

### Navigation

| Control | Action |
|---------|--------|
| **Left-click drag** | Rotate camera (orbit mode) |
| **Right-click drag** | Pan camera |
| **Scroll wheel** | Zoom in/out |
| **W/A/S/D** | Move camera forward/left/back/right |
| **Q / Space** | Move camera up |
| **E / Shift** | Move camera down |
| **Arrow keys** | Move camera |
| **?** | Show keyboard shortcuts |

### Camera Modes

- **Orbit** — Default architectural overview. Click and drag to orbit around the scene.
- **Walk (First Person)** — Ground-level walkthrough. Click to enter pointer lock, use mouse to look around, WASD to walk. Collision detection prevents walking through buildings.
- **Fly** — Free 6DOF flight. Click to enter pointer lock, WASD + Q/E for full movement. Collision detection included.

### Camera Presets

Click preset buttons in the controls panel:
- **Aerial** — Top-down view
- **Street** — Ground-level perspective
- **45 deg** — Classic architectural 3/4 view
- **Front** — Front elevation view

### Building Interaction

- **Click** a building to select it and open the info panel
- **Hover** over a building to see its name
- The info panel shows height, floors, roof type, area, and AI confidence score

### Editing Buildings

1. Select a building by clicking it
2. Click **Edit** in the info panel
3. Modify height, floor count, floor height, or roof type
4. Click **Save Changes**

### Material Assignment

In the building info panel, click a material button to change the facade:
- Concrete, Glass, Brick, Metal, Wood
- Materials update both the 3D rendering and building data

### Measurements

Enable measurements from the controls panel:

- **Distance** — Click two points to measure the distance between them
- **Area** — Click 3+ points to define a polygon, then press Enter to close and calculate area
- **Height** — Click a building to measure its height
- **Angle** — Click 3 points (start, vertex, end) to measure an angle

Toggle between **metric** (meters) and **imperial** (feet) units.

### Construction Phasing

If your project has construction phases:
1. Use the **phase timeline** slider in the controls panel
2. Click phase buttons to show/hide buildings by construction phase
3. Enable **Comparison Mode** to see a split-view between two phases with a draggable divider

### Shadows & Lighting

- Toggle **Shadows** on/off
- Adjust the **Time slider** (6:00 AM to 8:00 PM) to see shadow positions throughout the day
- Change the **Date** to see seasonal sun angle variation
- Enable **Shadow Study** to see a ground-plane heatmap of cumulative shadow coverage

### Map Background

Toggle between map styles in the controls:
- **Off** — Default sky and grid background
- **Satellite** — Satellite imagery from Mapbox
- **Streets** — Street map from Mapbox
- **Terrain** — Terrain map from Mapbox

### Layers

Toggle visibility of scene elements:
- **Buildings** — Project buildings
- **Landscaping** — Trees, green spaces, benches, light poles
- **Roads** — Road overlays
- **Grid** — Reference grid
- **Existing Buildings** — Context buildings from OpenStreetMap

### Camera Path Recording

1. Click **Record** to start recording camera movement
2. Navigate through the scene — keyframes are captured automatically
3. Click **Stop** to end recording
4. Click **Play** to replay the camera path
5. Use the **Video** button to capture the playback as a WebM video

### Annotations

1. Click the **Annotate** button in the top bar
2. Click on the 3D scene where you want to place a comment
3. Type your annotation text and click **Add**
4. Annotations appear as markers in the scene — click to view, resolve, or delete

### Exports

- **Screenshot** — Capture the current view at 1x, 2x, or 4x resolution
- **Export GLB** — Download the entire scene as a GLB file
- **Video Recording** — Record camera movement as a WebM video
- **Download 3D Model** — Download individual building GLB files from the info panel
- **PDF Report** — Download a project summary report from the project detail page

### Performance Monitor

Toggle **FPS Monitor** in the controls to see:
- Frames per second (target: 30+ FPS)
- Triangle count (budget: 500k)
- Draw calls (budget: 200)

Warning indicators appear when budgets are exceeded.

---

## Sharing & Collaboration

### Sharing a Project

1. Click **Share** on the project detail page
2. Enter a collaborator's email and select permission level (Viewer or Editor)
3. Click **Send Invite**
4. Or click **Create Public Link** to generate a shareable URL

### Real-Time Collaboration

When multiple users are viewing the same project in the 3D viewer:
- **Presence avatars** appear in the top bar showing who's online
- **Building edits** are broadcast in real-time — you'll see a toast notification when someone else modifies a building
- Changes are automatically refreshed in the viewer

### Permission Levels

- **Viewer** — Can view the project and 3D models, but cannot upload documents or modify buildings
- **Editor** — Full access to upload, edit, and delete within the project

---

## Tips

- Upload multiple documents at once by dragging them all into the upload area
- Use the mini-map in the bottom-left corner for spatial orientation
- The legend panel (bottom-left) explains phase colors and measurement types
- Press **?** at any time in the 3D viewer to see keyboard shortcuts
- Use the PDF Report button to generate a summary for stakeholders
