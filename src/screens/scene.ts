import type { Action, Tab } from '../input/actions';
import type { Screen } from '../gfx/screen';
import type { CastLabel } from '../ui/layout';

/** One whole screen of the game: title, character creation, or play. */
export interface Scene {
  input(a: Action): void;
  draw(s: Screen, now: number): void;
  /** True while the player is typing a name or seed (letters type instead of acting). */
  typing?(): boolean;
  /** The tab to highlight under the screen. */
  tab?(): Tab;
  /** Called when a scene is returned to (from Settings). */
  resume?(): void;
  /** What the class button under the screen should read. */
  castLabel?(): CastLabel;
}

/** Lets a scene switch to another one. */
export interface App {
  go(scene: Scene): void;
}
