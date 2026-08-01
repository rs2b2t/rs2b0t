import { sleep } from '#/util/JsUtil.js';
import Pix2D from '#/graphics/Pix2D.js';
import PixMap from '#/graphics/PixMap.js';
import { canvas, canvas2d } from '#/graphics/Canvas.js';
import { WALK_DESTINATIONS } from '../api/WalkDestinations.js';
import type { WalkDestination } from '../api/WalkDestinations.js';

import { MapView } from '../../mapview/MapView.js';
import WorldMapFont from '../../mapview/WorldMapFont.js';

/**
 * Standalone map renderer that loads worldmap data without hijacking the main game canvas.
 * Extends MapView but overrides run() to skip event binding and the game loop.
 */
class StandaloneMapView extends MapView {
    constructor() {
        const saved = canvas2d.getImageData(0, 0, canvas.width, canvas.height);
        super();
        canvas2d.putImageData(saved, 0, 0);
    }

    override async run(): Promise<void> {
        await this.drawProgress('Loading...', 0);
        await this.maininit();
    }

    override async drawProgress(_message: string, _progress: number): Promise<void> {
        await sleep(5);
    }

    protected override resize(width: number, height: number): void {
        this.drawArea = new PixMap(width, height);
    }
}

export class WorldMapPicker {
    private mapView: MapView;

    // Viewport selection box state
    public selectedX: number = 0;
    public selectedZ: number = 0;
    public selectionWidth: number = 0;
    public selectionHeight: number = 0;

    // User-selected tile (click to select)
    public selectedTile: { x: number; z: number; level: number } | null = null;

    // Interaction state
    public isDragging: boolean = false;
    private lastMouseX: number = 0;
    private lastMouseY: number = 0;

    // Destination selection callback
    public onDestinationSelected?: (destination: WalkDestination) => void;

    constructor(mapView: MapView) {
        this.mapView = mapView;
    }

    /**
     * Opens an interactive map modal to pick coordinates.
     */
    public static open(activeMapView?: MapView): Promise<{ x: number; z: number; level: number } | null> {
        return new Promise((resolve) => {
            // 1. Create dark overlay container
            const overlay = document.createElement('div');
            overlay.className = 'rs2b0t-modal-overlay';
            Object.assign(overlay.style, {
                position: 'fixed',
                top: '0',
                left: '0',
                width: '100vw',
                height: '100vh',
                backgroundColor: 'rgba(0, 0, 0, 0.85)',
                zIndex: '9999',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center'
            });

            // 2. Create interactive canvas & obtain 2D rendering context
            const canvas = document.createElement('canvas');
            canvas.width = 640;
            canvas.height = 480;
            canvas.style.backgroundColor = '#000';
            canvas.style.border = '2px solid #555';
            canvas.style.cursor = 'crosshair';

            const ctx = canvas.getContext('2d')!;

            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'rs2b0t-button';
            cancelBtn.textContent = 'Cancel';
            cancelBtn.style.marginTop = '12px';

            const confirmBtn = document.createElement('button');
            confirmBtn.className = 'rs2b0t-button';
            confirmBtn.textContent = 'Confirm';
            confirmBtn.style.marginTop = '12px';
            confirmBtn.style.marginLeft = '8px';
            confirmBtn.style.display = 'none';
            confirmBtn.disabled = true;

            overlay.appendChild(canvas);
            // Instruction text
            const instruction = document.createElement('div');
            instruction.textContent = 'Click on the map to select a tile, then press Confirm';
            instruction.style.color = '#aaa';
            instruction.style.margin = '8px 0';
            instruction.style.fontSize = '13px';
            instruction.style.textAlign = 'center';
            overlay.appendChild(instruction);
            const btnRow = document.createElement('div');
            btnRow.style.display = 'flex';
            btnRow.style.justifyContent = 'center';
            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(confirmBtn);
            overlay.appendChild(btnRow);
            document.body.appendChild(overlay);

            // Reuse active MapView or construct a standalone renderer
            const mapView = activeMapView ?? new StandaloneMapView();
            const picker = new WorldMapPicker(mapView);

            // Bind PixMap raster target using the 2D context
            const pixMap = new PixMap(canvas.width, canvas.height, ctx);

            const cleanup = () => {
                canvas.removeEventListener('click', onCanvasClick);
                document.body.removeChild(overlay);
            };

            cancelBtn.addEventListener('click', () => {
                cleanup();
                resolve(null);
            });

            confirmBtn.addEventListener('click', () => {
                if (picker.selectedTile) {
                    cleanup();
                    resolve(picker.selectedTile);
                }
            });

            // Click handler - convert canvas pixel coords to world tile coords
            const onCanvasClick = (e: MouseEvent) => {
                const rect = canvas.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const clickY = e.clientY - rect.top;

                // Convert click position to world tile coordinates
                const tileX: number = mapView.mapOriginX + ((clickX / canvas.width) * mapView.mapWidth) | 0;
                const tileZ: number = mapView.mapOriginZ + mapView.mapHeight - ((clickY / canvas.height) * mapView.mapHeight) | 0;

                picker.selectedTile = { x: tileX, z: tileZ, level: 0 };

                // Re-render map to clear previous crosshair
                pixMap.setPixels();
                mapView.renderWorldMap(
                    0, 0,
                    mapView.mapWidth, mapView.mapHeight,
                    0, 0,
                    canvas.width, canvas.height
                );
                pixMap.draw(0, 0);
                pixMap.setPixels();
                picker.drawWalkDestinations(0, 0, canvas.width, canvas.height);
                pixMap.draw(0, 0);

                // Draw crosshair marker using raw canvas 2D context
                drawCrosshair(ctx, clickX, clickY);

                // Show confirm button
                confirmBtn.style.display = 'inline-block';
                confirmBtn.disabled = false;
                canvas.style.cursor = 'default';
            };

            // Draw crosshair at pixel position using native canvas API (no Pix2D)
            const drawCrosshair = (ctx: CanvasRenderingContext2D, cx: number, cy: number) => {
                const size = 10;
                ctx.save();
                ctx.strokeStyle = '#ffff00';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(cx - size, cy);
                ctx.lineTo(cx + size, cy);
                ctx.moveTo(cx, cy - size);
                ctx.lineTo(cx, cy + size);
                ctx.stroke();
                // Black outline
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.moveTo(cx - size, cy);
                ctx.lineTo(cx + size, cy);
                ctx.moveTo(cx, cy - size);
                ctx.lineTo(cx, cy + size);
                ctx.stroke();
                ctx.restore();
            };

            canvas.addEventListener('click', onCanvasClick);

            // Wait for MapView data to load, then render the full map ONCE and stop the game loop
            (async () => {
                if (!activeMapView) {
                    while (!mapView.overview) {
                        await new Promise(r => setTimeout(r, 100));
                    }
                }

                // Render the entire world map into the canvas-sized PixMap
                pixMap.setPixels();
                mapView.renderWorldMap(
                    0,
                    0,
                    mapView.mapWidth,
                    mapView.mapHeight,
                    0,
                    0,
                    canvas.width,
                    canvas.height
                );

                // Output the rendered pixels to the canvas
                pixMap.draw(0, 0);

                // Draw WalkDestinations markers on top (using Pix2D since they're simple)
                pixMap.setPixels();
                picker.drawWalkDestinations(0, 0, canvas.width, canvas.height);
                pixMap.draw(0, 0);

                // Restore Pix2D to main canvas so game client draws correctly afterward
                mapView.refreshRaster();
            })();
        });
    }

    /**
     * Updates the selection box position and size based on the current MapView viewport.
     */
    public updateSelectionFromView(viewMinX: number, viewMinZ: number, viewMaxX: number, viewMaxZ: number): void {
        this.selectedX = viewMinX;
        this.selectedZ = viewMinZ;
        this.selectionWidth = viewMaxX - viewMinX;
        this.selectionHeight = viewMaxZ - viewMinZ;
    }

    /**
     * Draws labeled destination pins onto the map picker view.
     */
    private drawWalkDestinations(drawX: number, drawY: number, drawWidth: number, drawHeight: number): void {
        const font: WorldMapFont | null = this.mapView.f12;

        for (const dest of WALK_DESTINATIONS) {
            const pos = this.tileToScreenPos(dest.tile.x, dest.tile.z, drawX, drawY, drawWidth, drawHeight);
            if (!pos) {
                continue;
            }

            // Draw destination point marker
            Pix2D.fillRect(pos.screenX - 2, pos.screenY - 2, 5, 5, 0x00ffff);
            Pix2D.drawRect(pos.screenX - 3, pos.screenY - 3, 7, 7, 0x000000);

            // Draw label text with drop shadow using WorldMapFont
            if (font) {
                font.drawString(dest.name, pos.screenX + 5, pos.screenY + 3, 0x00ffff, true);
            }
        }
    }

    /**
     * Converts world tile coordinates (x, z) to pixel coordinates on the picker surface.
     */
    private tileToScreenPos(
        tileX: number,
        tileZ: number,
        drawX: number,
        drawY: number,
        drawWidth: number,
        drawHeight: number
    ): { screenX: number; screenY: number } | null {
        // Convert world tile coordinate to map-local offset coordinate
        const localX: number = tileX - this.mapView.mapOriginX;
        const localZ: number = this.mapView.mapHeight - (tileZ - this.mapView.mapOriginZ);

        if (localX < 0 || localX >= this.mapView.mapWidth || localZ < 0 || localZ >= this.mapView.mapHeight) {
            return null; // Out of bounds for current plane map view
        }

        const screenX: number = drawX + ((localX * drawWidth) / this.mapView.mapWidth) | 0;
        const screenY: number = drawY + ((localZ * drawHeight) / this.mapView.mapHeight) | 0;

        return { screenX, screenY };
    }
}