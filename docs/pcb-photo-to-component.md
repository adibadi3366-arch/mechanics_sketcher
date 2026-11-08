# From a photo of a board to a Mech Sketch component

You are given one or more photos of an electronics board or module (a flight
controller, an ESC, a sensor breakout, a receiver, a motor). Write a
**component file**: a JSON description of the board as a simplified vector
drawing, in the style of an assembly manual, with its connectors as **ports**
whose **pins** wires can be attached to. Mech Sketch places the file in a
wiring guide, draws coloured tags with the pin names beside each connector, and
runs wires to them.

Reply with the JSON only, in one code block. No comments inside the JSON.

## What to draw

A manual drawing, not a photo trace. Keep:

- the outline of the board, with its corner radius, and the mounting holes;
- every connector wires plug into or are soldered onto, at its true place and
  size, each as a port;
- the main chips (processor, IMU, OSD, driver chips, big MOSFETs) as boxes,
  with their part name where it is legible;
- what a person uses to find their way: buttons, LEDs, an SD slot, an antenna
  socket, an arrow for forward, the board's name and the port names printed on
  the silkscreen;
- a sprinkling of small passives and vias where the photo shows them, for the
  look. Twenty or thirty at most on a busy board; none on a simple one.

Leave out traces, tiny text, logos and anything you cannot see clearly.
Do not invent connectors or pins. Where a pin's name cannot be read, use what
the board's documentation calls it if you know the board well; otherwise name
it by number (`1`, `2`, ...) and say so in the `caption`.

## Coordinates

- Units are millimetres (`"units": "mm"`). Measure from a known size: a JST-SH
  connector has a 1.0 mm pitch, JST-GH 1.25 mm, a pin header 2.54 mm, an
  M3 mounting hole is 3.2 mm across, and boards are often sold by their hole
  spacing (30.5 × 30.5, 20 × 20, 25.5 × 25.5 mm) — the board itself is then
  about 6 mm larger.
- x runs to the right, **y runs down**, from the top left corner of the board's
  bounding box. `"size": [w, h]` is that box.
- Draw the board the way it is usually shown: component side up, connectors
  where they are on the real board, text the right way up.

## The file

```json
{
  "format": "mech-sketch-component",
  "version": 1,
  "name": "M10 GPS + compass",
  "ref": "GPS",
  "caption": "M10 GPS + compass",
  "units": "mm",
  "size": [26, 26],
  "shapes": [
    {"type": "rect", "x": 0, "y": 0, "w": 26, "h": 26, "r": 2.6, "fill": "#214e95", "stroke": "#153a74", "width": 0.3},
    {"type": "rect", "x": 3, "y": 3, "w": 17, "h": 17, "r": 1, "fill": "#e6dab8", "stroke": "#c4b58c", "width": 0.2},
    {"type": "chip", "x": 20.6, "y": 4.4, "w": 2.4, "h": 2.4, "dot": true},
    {"type": "circle", "x": 22.2, "y": 2.2, "r": 0.55, "fill": "#55d17a"},
    {"type": "text", "x": 11.5, "y": 23, "text": "M10", "size": 1.7, "color": "#dfe8f5"}
  ],
  "ports": [
    {"name": "GPS", "side": "right", "x": 26, "y": 13, "draw": "jst-sh",
     "pins": ["GND", "5V", "Rx", "Tx", "SCL", "SDA"]}
  ]
}
```

- `name`: what the board is, as a person would look for it in a library.
- `ref`: short name a placed board goes by in a connection list: `H743`,
  `ESC`, `GPS`, `VTX`, `RX`. No commas.
- `caption`: written under the board on the guide. `\n` starts a new line.
  Use `""` for none (a flight controller usually has its name in the title).

### Shapes

Shapes are drawn in the order given, later ones on top. Colours are hex
(`"#262a30"`). `width` is a line's thickness in mm. Every shape takes the
fields shown; fields in brackets may be left out.

| type | fields | notes |
| --- | --- | --- |
| `rect` | `x, y, w, h, [r], [fill], [stroke], [width]` | `x, y` is the top left corner; `r` rounds the corners |
| `circle` | `x, y, r, [fill], [stroke], [width]` | `x, y` is the centre |
| `line` | `points: [[x, y], ...], [stroke], [width]` | an open line through the points |
| `polygon` | `points: [[x, y], ...], [fill], [stroke], [width]` | closed |
| `arc` | `x, y, r, start, end, [stroke], [width]` | degrees, counter-clockwise as seen, 0 to the right |
| `text` | `x, y, text, [size], [color], [bold], [align], [rotate]` | `x, y` is the **middle** of the text (or its start or end with `align`: `start`, `middle`, `end`); `size` is the letter height as the em in mm, 1.3 suits silkscreen on a 36 mm board; `rotate` is degrees counter-clockwise, 90 for text reading upwards; bold unless `"bold": false` |
| `connector` | `x, y, side, pins, [style], [pitch], [mark]` | a wire-to-board connector drawn complete: housing, opening, contacts and a pin-1 dot. `x, y` is the middle of its opening **on the board edge**; `side` is the edge it opens to: `top`, `bottom`, `left`, `right`; `style` is `jst-sh` (default), `jst-gh` or `header` |
| `chip` | `x, y, w, h, [label], [legs], [dot], [fill], [size]` | an IC: a dark box from its top left corner; `legs` puts that many legs on each side (QFP); `dot` marks pin 1; `label` is written on it |
| `hole` | `x, y, [r], [ring]` | a plated mounting hole: `r` the hole, `ring` the copper round it (M3: `r` 1.6, `ring` 2.4; on a 30.5 mm board 2.0 and 2.8) |
| `pad` | `x, y, w, h, [label]` | a gold solder pad centred on `x, y`, such as a battery or motor pad |
| `passive` | `x, y, [kind], [vertical]` | a 0402 part: `kind` `c` (capacitor, tan) or `r` (resistor, black) |
| `led` | `x, y, [color]` | a small SMD LED |
| `button` | `x, y, [size]` | a tactile switch, `size` mm across |

A connector port with `"draw": "jst-sh"` (or `jst-gh`, `header`) draws its
connector itself, so it need not be listed under shapes as well. Either way is
fine; do not draw it twice.

Suggested colours: board `#262a30` with edge `#121417` and an inner line
`#33383e` (or the board's own colour: blue `#214e95`, green `#1f5f3a`, purple
`#3d2a73`, red `#8f1d1d`); silkscreen `#eef0f1`; gold `#d8b660` with
`#a8883c`; chips `#363b41`; metal shields `#d2d7db` with `#8b939a`.

### Ports

A port is one connector, or one group of solder pads that a bundle of wires
goes to. Its wires are drawn as one bundle.

```json
{"name": "GPS", "side": "bottom", "x": 10.8, "y": 36, "pitch": 1.0,
 "pins": ["GND", "5V", "Tx3", "Rx3", "SCL", "SDA"]}
```

- `name`: as printed on the board (`UART4`, `ESC1`, `GPS`, `SBUS/CRSF`,
  `VIDEO-OUT`). Every port of a board needs a different name.
- `side`: the edge the wires leave by.
- `x, y`: the middle of the connector, on the board edge (the same point as
  its `connector` shape).
- `pins`: the pin names **in order along the edge**: left to right on the
  `top` and `bottom` edges, top to bottom on the `left` and `right` edges, as
  seen in the drawing. Spaced `pitch` apart (1.0 when left out; 1.25 for GH,
  2.54 for headers, or give `"style"`).
- `"kind": "pads"` for solder pads: the wires then run onto the pins
  themselves instead of starting at tags beside the board. Give such pins one
  by one, at the middle of each pad, and a thicker `wire` where the pads take
  thick wires (battery leads 1.25, motor wires 0.6):

```json
{"name": "BAT", "side": "top", "kind": "pads", "wire": 1.25,
 "pins": [{"name": "+", "x": 16, "y": 2.9}, {"name": "-", "x": 24, "y": 2.9}]}
```

Pin names decide the colour of their tag, so write them the way boards do:
`GND`, `5V`, `3V3`, `4V5`, `9V`, `VBAT`, `Tx2`, `Rx2`, `SCL`, `SDA`, `M1`,
`Curr`, `VIDEO`, `SBUS`, `LED`, `Buzz-`, `+`, `-`. Two pins of one port must
not share a name.

## Checks before you answer

1. Every number is in mm and inside `size` (a connector may stick out a little;
   antennas and sockets past the edge are fine).
2. Each port's `x, y` lies on the edge named by its `side`.
3. Pins are listed left to right, or top to bottom, as they appear.
4. The JSON parses: double quotes, no trailing commas, no comments.
