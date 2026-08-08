# DreamFrame Shot Editor

## Workflow

DreamFrame uses `public/workflows/wan2.2-shot-editor-i2v.json` as the WAN 2.2 image-to-video template for every scene.

## Editing scenes

1. Open **Cinematic Shot Editor**.
2. Upload the opening frame.
3. Select a scene from the timeline.
4. Edit its title, scene direction, optional negative direction, duration, camera movement, and lens.
5. Add a custom scene reference to render it independently, or leave it empty to inherit the previous scene's final frame.
6. Reorder, duplicate, delete, or add scenes. The editor supports up to 12 scenes.
7. In Multiple PCs mode, select a render PC for each scene.
8. Open the render queue and run scenes manually or use **Run All Ready**.

## Scene plans

- **Export plan** saves scene text and technical settings as JSON.
- **Import plan** loads a saved DreamFrame scene plan.
- Reference image pixels are intentionally not embedded into the exported JSON; add or replace them after importing.

## Editing after a render

On the completed output page, press **Edit Scenes**. DreamFrame reopens the shot editor with the saved scene plan and opening frame so the scene can be changed and rendered again.
