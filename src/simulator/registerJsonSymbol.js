import { DRAW_LIB } from "simulator/drawLib";
import { makeSvgFromShapes } from "./makeSvgFromShapes";

export function registerJsonSymbol(key, json) {
  DRAW_LIB[key] = {
    ...json,
    draw(el) {
      return makeSvgFromShapes(json, el);
    }
  };
}
