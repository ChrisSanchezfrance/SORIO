class_name PowerData
extends Resource
## Definition d'un pouvoir (A.6).
##
## Un pouvoir est une DONNEE, jamais du code. Ajouter le 37e ne doit demander
## qu'un `.tres` de plus, tant que sa famille existe deja.
##
## Ce fichier porte trois choses : ce que le pouvoir coute (duree ou
## charges), a quoi il ressemble sur SORIO (couleur et tenue), et ce qu'il
## fait (`effects`, rempli par les 8 briques de A.6.3).

## Familles de A.6. La famille determine quelles briques d'effet sont
## legitimes, et sert a regrouper l'album de collection.
enum Family {
	OFFENSIVE_RANGED,
	OFFENSIVE_CONTACT,
	OFFENSIVE_AREA,
	DEFENSIVE,
	CONTROL,
	MOBILITY,
	SUMMON,
	UTILITY,
	LEGENDARY,
}

## Rarete de A.6 : commun 60 %, rare 30 %, epique 9 %, legendaire 1 %.
enum Rarity { COMMON, RARE, EPIC, LEGENDARY }

## Poids de tirage, en pour-cent. Somme = 100.
const RARITY_WEIGHTS: Dictionary = {
	Rarity.COMMON: 60,
	Rarity.RARE: 30,
	Rarity.EPIC: 9,
	Rarity.LEGENDARY: 1,
}

@export var id: StringName = &""
@export var name_key: String = ""
@export var description_key: String = ""
@export var family: Family = Family.UTILITY
@export var rarity: Rarity = Rarity.COMMON

@export_group("Cout")
## Duree en secondes. Zero si le pouvoir fonctionne par charges.
@export var duration: float = 0.0
## Nombre d'utilisations. Zero si le pouvoir fonctionne par duree.
@export var charges: int = 0

@export_group("Apparence")
## Couleur du pouvoir. C'est ELLE qui teint la tenue de SORIO : un enfant
## doit reconnaitre son pouvoir d'un coup d'oeil sur le personnage, sans
## avoir a lire une icone de HUD.
@export var color: Color = Color(0.9, 0.9, 0.9)
## Couleur secondaire (pantalon, bottes). Vide = derivee de `color`.
@export var color_secondary: Color = Color(0, 0, 0, 0)
## Halo colore autour de SORIO, de 0 a 1. Les pouvoirs defensifs et les
## auras en portent plus que les pouvoirs a charges.
@export_range(0.0, 1.0) var aura_strength: float = 0.0

@export_group("Effets")
## Les 8 briques de A.6.3. Vide tant que la brique correspondante n'existe
## pas : le pouvoir est alors collectionnable et visible, mais inerte.
@export var effects: Array[Resource] = []


## true si le pouvoir s'epuise au temps plutot qu'a l'usage.
func is_timed() -> bool:
	return duration > 0.0


## Couleur secondaire effective. Assombrir la couleur principale donne une
## tenue coherente sans avoir a choisir deux teintes pour chaque pouvoir.
func secondary_color() -> Color:
	if color_secondary.a > 0.0:
		return color_secondary
	return color.darkened(0.45)


func rarity_name() -> String:
	match rarity:
		Rarity.RARE:
			return "rare"
		Rarity.EPIC:
			return "epique"
		Rarity.LEGENDARY:
			return "legendaire"
		_:
			return "commun"


func validate() -> PackedStringArray:
	var problems: PackedStringArray = PackedStringArray()
	if String(id).is_empty():
		problems.append("id vide")
	if name_key.is_empty():
		problems.append("%s : name_key vide" % id)
	# Un pouvoir sans duree NI charges ne s'epuiserait jamais.
	if duration <= 0.0 and charges <= 0:
		problems.append("%s : ni duree ni charges" % id)
	if duration > 0.0 and charges > 0:
		problems.append("%s : duree ET charges, il faut choisir" % id)
	if color.a <= 0.0:
		problems.append("%s : couleur transparente, SORIO ne changerait pas" % id)
	return problems
