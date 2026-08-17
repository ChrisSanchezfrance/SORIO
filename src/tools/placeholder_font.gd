class_name PlaceholderFont
extends RefCounted
## Fonte matricielle 3x5 minuscule, dessinee directement dans les pixels.
##
## Raison d'etre : `generate_placeholders.gd` tourne en `--headless`, ou aucun
## serveur de rendu de texte n'existe. Pour que les placeholders soient
## reellement ETIQUETES ("RAPTOZ", "ECLAIR") et pas juste des rectangles de
## couleur, il faut savoir ecrire dans une `Image` sans passer par une fonte
## systeme. D'ou cette table.

const CHAR_WIDTH: int = 3
const CHAR_HEIGHT: int = 5
const CHAR_SPACING: int = 1

## Caractere -> 5 lignes de 3 bits (bit 2 = pixel gauche).
const GLYPHS: Dictionary = {
	"A": [0b010, 0b101, 0b111, 0b101, 0b101],
	"B": [0b110, 0b101, 0b110, 0b101, 0b110],
	"C": [0b011, 0b100, 0b100, 0b100, 0b011],
	"D": [0b110, 0b101, 0b101, 0b101, 0b110],
	"E": [0b111, 0b100, 0b110, 0b100, 0b111],
	"F": [0b111, 0b100, 0b110, 0b100, 0b100],
	"G": [0b011, 0b100, 0b101, 0b101, 0b011],
	"H": [0b101, 0b101, 0b111, 0b101, 0b101],
	"I": [0b111, 0b010, 0b010, 0b010, 0b111],
	"J": [0b001, 0b001, 0b001, 0b101, 0b010],
	"K": [0b101, 0b101, 0b110, 0b101, 0b101],
	"L": [0b100, 0b100, 0b100, 0b100, 0b111],
	"M": [0b101, 0b111, 0b111, 0b101, 0b101],
	"N": [0b101, 0b111, 0b111, 0b111, 0b101],
	"O": [0b010, 0b101, 0b101, 0b101, 0b010],
	"P": [0b110, 0b101, 0b110, 0b100, 0b100],
	"Q": [0b010, 0b101, 0b101, 0b111, 0b011],
	"R": [0b110, 0b101, 0b110, 0b101, 0b101],
	"S": [0b011, 0b100, 0b010, 0b001, 0b110],
	"T": [0b111, 0b010, 0b010, 0b010, 0b010],
	"U": [0b101, 0b101, 0b101, 0b101, 0b011],
	"V": [0b101, 0b101, 0b101, 0b101, 0b010],
	"W": [0b101, 0b101, 0b111, 0b111, 0b101],
	"X": [0b101, 0b101, 0b010, 0b101, 0b101],
	"Y": [0b101, 0b101, 0b010, 0b010, 0b010],
	"Z": [0b111, 0b001, 0b010, 0b100, 0b111],
	"0": [0b111, 0b101, 0b101, 0b101, 0b111],
	"1": [0b010, 0b110, 0b010, 0b010, 0b111],
	"2": [0b111, 0b001, 0b111, 0b100, 0b111],
	"3": [0b111, 0b001, 0b111, 0b001, 0b111],
	"4": [0b101, 0b101, 0b111, 0b001, 0b001],
	"5": [0b111, 0b100, 0b111, 0b001, 0b111],
	"6": [0b111, 0b100, 0b111, 0b101, 0b111],
	"7": [0b111, 0b001, 0b001, 0b001, 0b001],
	"8": [0b111, 0b101, 0b111, 0b101, 0b111],
	"9": [0b111, 0b101, 0b111, 0b001, 0b111],
	"-": [0b000, 0b000, 0b111, 0b000, 0b000],
	"_": [0b000, 0b000, 0b000, 0b000, 0b111],
	" ": [0b000, 0b000, 0b000, 0b000, 0b000],
}


## Largeur en pixels d'un texte a l'echelle donnee.
static func measure(text: String, scale: int) -> int:
	if text.is_empty():
		return 0
	return text.length() * (CHAR_WIDTH + CHAR_SPACING) * scale - CHAR_SPACING * scale


static func height(scale: int) -> int:
	return CHAR_HEIGHT * scale


## Ecrit `text` dans `image` a partir de (x, y). Les caracteres inconnus sont
## remplaces par un espace plutot que d'interrompre la generation.
static func draw_text(
	image: Image, text: String, x: int, y: int, scale: int, color: Color
) -> void:
	var cursor: int = x
	for i: int in range(text.length()):
		var glyph_key: String = text.substr(i, 1).to_upper()
		var rows: Array = GLYPHS.get(glyph_key, GLYPHS[" "])
		_draw_glyph(image, rows, cursor, y, scale, color)
		cursor += (CHAR_WIDTH + CHAR_SPACING) * scale


static func _draw_glyph(
	image: Image, rows: Array, x: int, y: int, scale: int, color: Color
) -> void:
	for row: int in range(CHAR_HEIGHT):
		var bits: int = int(rows[row])
		for column: int in range(CHAR_WIDTH):
			# Bit de poids fort a gauche.
			if not (bits & (1 << (CHAR_WIDTH - 1 - column))):
				continue
			_fill_block(image, x + column * scale, y + row * scale, scale, color)


static func _fill_block(image: Image, x: int, y: int, scale: int, color: Color) -> void:
	for dy: int in range(scale):
		for dx: int in range(scale):
			var px: int = x + dx
			var py: int = y + dy
			if px >= 0 and py >= 0 and px < image.get_width() and py < image.get_height():
				image.set_pixel(px, py, color)


## Echelle la plus grande qui fasse tenir `text` dans `max_width`.
static func fit_scale(text: String, max_width: int, max_scale: int = 4) -> int:
	for scale: int in range(max_scale, 0, -1):
		if measure(text, scale) <= max_width:
			return scale
	return 1
