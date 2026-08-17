class_name GiftBox
extends StaticBody2D
## Cadeau Surprise (A.6).
##
## Caisse solide : SORIO marche dessus, s'y cogne, et la casse. TROIS facons
## de l'ouvrir, toutes equivalentes :
##
##   1. **un coup de tete par en dessous** — on saute dedans ;
##   2. **un coup** (bouton B) ;
##   3. **un pouvoir** (bouton C).
##
## Trois entrees pour une meme action, c'est volontaire ici, contrairement au
## saut : ce sont trois verbes DIFFERENTS qui aboutissent au meme resultat.
## Un enfant qui n'a pas encore compris le coup de tete trouvera le cadeau
## en tapant dessus, et inversement. Rien ne le bloque.
##
## Le contenu ne flotte pas : il fonce sur SORIO et se fait absorber (voir
## `Pickup`).

## Nombre de coups avant ouverture. A 1 par defaut : un cadeau qui resiste
## n'apporte rien a 8 ans.
@export var hits_required: int = 1
## Pouvoir contenu. Vide = tire au sort a l'ouverture selon la table de
## rarete de A.6 (commun 60 %, rare 30 %, epique 9 %, legendaire 1 %).
@export var content_id: StringName = &""
## Ambres accordes en plus du pouvoir.
@export var amber_value: int = 5

## Vitesse verticale minimale (vers le haut) pour qu'un coup de tete compte.
const HEAD_BUMP_MIN_SPEED: float = -60.0
## Sursaut de la caisse quand on la frappe sans l'ouvrir.
const NUDGE_PIXELS: float = 6.0
const NUDGE_SECONDS: float = 0.09
## Scene de l'objet qui sort. Injectable pour les tests.
const PICKUP_SCENE: String = "res://src/entities/pickups/pickup.tscn"

signal opened(box: GiftBox)

## Cible des objets ejectes. Injectee par le niveau (D.2.4).
var player: Node2D = null

var _remaining_hits: int = 1
var _is_open: bool = false
var _origin: Vector2 = Vector2.ZERO

@onready var _hit_zone: Area2D = $HitZone


func _ready() -> void:
	collision_layer = CollisionLayers.WORLD
	collision_mask = 0
	_remaining_hits = maxi(1, hits_required)
	_origin = position

	# La zone sensible ne bloque rien : elle ecoute seulement les projectiles
	# du joueur, ce qui couvre le coup (bouton B) et les pouvoirs (passe 4).
	_hit_zone.collision_layer = CollisionLayers.BREAKABLE
	_hit_zone.collision_mask = CollisionLayers.PLAYER_PROJECTILE
	_hit_zone.area_entered.connect(_on_hit_zone_entered)
	queue_redraw()


## Injection depuis le niveau : le cadeau ne cherche jamais le joueur.
func setup(target: Node2D) -> void:
	player = target


func _on_hit_zone_entered(area: Area2D) -> void:
	# Tout ce qui vient du joueur ouvre le cadeau : coup de B aujourd'hui,
	# projectiles de pouvoir demain, sans une ligne a changer ici.
	hit(&"attack")


## Coup de tete par en dessous. Appele par le joueur, qui est le seul a
## savoir a quelle vitesse il montait au moment du contact.
func head_bump(upward_speed: float) -> bool:
	if upward_speed > HEAD_BUMP_MIN_SPEED:
		return false
	return hit(&"head")


## Encaisse un coup. Retourne true si le cadeau s'est ouvert.
func hit(cause: StringName) -> bool:
	if _is_open:
		return false
	_remaining_hits -= 1
	if _remaining_hits > 0:
		_nudge()
		return false
	_open(cause)
	return true


## Sursaut vers le haut : le cadeau reagit meme quand il ne s'ouvre pas,
## sinon le joueur croit que son coup n'a rien fait.
func _nudge() -> void:
	Haptics.pulse(&"stomp")
	var tween: Tween = create_tween()
	tween.tween_property(self, "position:y", _origin.y - NUDGE_PIXELS, NUDGE_SECONDS)
	tween.tween_property(self, "position:y", _origin.y, NUDGE_SECONDS)


func _open(cause: StringName) -> void:
	_is_open = true
	Haptics.pulse(&"power_pickup")
	EventBus.screen_shake_requested.emit(3.0, 0.12)
	_spawn_contents()
	opened.emit(self)

	# La caisse cesse d'etre solide immediatement : rester bloque sur un
	# cadeau deja ouvert serait incomprehensible.
	set_deferred(&"collision_layer", 0)
	_hit_zone.set_deferred(&"monitoring", false)
	_play_break_effect()


## Un cadeau = UN pouvoir. Un seul objet qui sort se lit mieux que trois :
## l'enfant comprend qu'il vient de gagner quelque chose de precis.
func _spawn_contents() -> void:
	var scene: PackedScene = load(PICKUP_SCENE) as PackedScene
	if scene == null:
		push_error("[GiftBox] scene d'objet introuvable : %s" % PICKUP_SCENE)
		return

	var power: PowerData = _pick_power()
	var pickup: Pickup = scene.instantiate() as Pickup
	pickup.amber_value = amber_value
	if power != null:
		pickup.item_id = power.id
		pickup.power = power
		# L'objet porte deja la couleur du pouvoir : on sait ce qu'on a
		# gagne avant meme de l'avoir absorbe.
		pickup.tint = power.color
	get_parent().add_child(pickup)
	pickup.launch(global_position, player, 0.0)


func _pick_power() -> PowerData:
	if not String(content_id).is_empty():
		return Database.power(content_id) as PowerData
	return PowerSystem.roll_random_power()


func _play_break_effect() -> void:
	var tween: Tween = create_tween().set_parallel(true)
	tween.tween_property(self, "scale", Vector2(1.35, 0.6), 0.10)
	tween.tween_property(self, "modulate:a", 0.0, 0.16)
	tween.chain().tween_callback(queue_free)


# --- Dessin -----------------------------------------------------------------

## Un vrai cadeau : caisse de bois cerclee, ruban croise et noeud sur le
## dessus. Un enfant doit reconnaitre un CADEAU au premier regard, pas une
## caisse quelconque — c'est ce qui donne envie d'aller le chercher.

const BOX_SIZE: float = 60.0
const WOOD: Color = Color(0.72, 0.50, 0.26)
const WOOD_DARK: Color = Color(0.56, 0.37, 0.18)
const WOOD_LIGHT: Color = Color(0.84, 0.62, 0.34)
const OUTLINE: Color = Color(0.20, 0.12, 0.06)
const RIBBON: Color = Color(0.92, 0.24, 0.32)
const RIBBON_LIGHT: Color = Color(1.00, 0.46, 0.52)
const RIBBON_WIDTH: float = 12.0
const OUTLINE_WIDTH: float = 4.0


func _draw() -> void:
	var half: float = BOX_SIZE * 0.5
	var body: Rect2 = Rect2(-half, -half, BOX_SIZE, BOX_SIZE)

	# Corps, avec une face superieure plus claire : le volume se lit sans
	# avoir a dessiner de perspective.
	draw_rect(body, WOOD)
	draw_rect(Rect2(-half, -half, BOX_SIZE, BOX_SIZE * 0.26), WOOD_LIGHT)
	draw_rect(Rect2(-half, half - BOX_SIZE * 0.18, BOX_SIZE, BOX_SIZE * 0.18), WOOD_DARK)

	# Ruban croise, vertical puis horizontal.
	draw_rect(Rect2(-RIBBON_WIDTH * 0.5, -half, RIBBON_WIDTH, BOX_SIZE), RIBBON)
	draw_rect(Rect2(-half, -RIBBON_WIDTH * 0.5, BOX_SIZE, RIBBON_WIDTH), RIBBON)
	# Un liseré clair sur le ruban : il brille, donc il attire l'oeil.
	draw_rect(Rect2(-RIBBON_WIDTH * 0.5, -half, RIBBON_WIDTH * 0.32, BOX_SIZE), RIBBON_LIGHT)

	_draw_bow(-half)
	draw_rect(body, OUTLINE, false, OUTLINE_WIDTH)


## Noeud sur le dessus : deux boucles et un centre. C'est lui qui transforme
## la caisse en cadeau.
func _draw_bow(top: float) -> void:
	var knot: Vector2 = Vector2(0.0, top - 2.0)
	for side: float in [-1.0, 1.0]:
		var loop: Vector2 = knot + Vector2(side * 13.0, -7.0)
		draw_colored_polygon(PackedVector2Array([
			knot,
			loop + Vector2(side * 4.0, -7.0),
			loop + Vector2(side * 10.0, 1.0),
			knot + Vector2(side * 5.0, 5.0),
		]), RIBBON)
		draw_circle(loop + Vector2(side * 4.0, -2.0), 3.0, RIBBON_LIGHT)
	draw_circle(knot, 6.0, RIBBON)
	draw_circle(knot + Vector2(-1.5, -1.5), 2.6, RIBBON_LIGHT)


func is_open() -> bool:
	return _is_open
