class_name GiftBox
extends StaticBody2D
## Cadeau Surprise (A.6).
##
## Caisse solide : SORIO marche dessus, s'y cogne, et la casse. TROIS facons
## de l'ouvrir, toutes equivalentes :
##
##   1. **un coup de tete par en dessous** — on saute dedans ;
##   2. **un coup** (bouton B) ;
##   3. **un pouvoir** (bouton C, a partir de la passe 4).
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
## Identifiant de l'objet contenu. En passe 4, la table de rarete de A.6
## remplira ce champ avec un pouvoir ; d'ici la, c'est de l'ambre.
@export var content_id: StringName = &"amber"
@export var amber_value: int = 10
## Nombre d'objets qui jaillissent. Plusieurs objets se lisent mieux qu'un
## seul : ca ressemble a une recompense, pas a un simple ramassage.
@export var content_count: int = 3

## Vitesse verticale minimale (vers le haut) pour qu'un coup de tete compte.
const HEAD_BUMP_MIN_SPEED: float = -60.0
## Sursaut de la caisse quand on la frappe sans l'ouvrir.
const NUDGE_PIXELS: float = 6.0
const NUDGE_SECONDS: float = 0.09
## Ecartement horizontal des objets qui jaillissent.
const SPREAD_PIXELS: float = 90.0

## Scene de l'objet qui sort. Injectable pour les tests.
const PICKUP_SCENE: String = "res://src/entities/pickups/pickup.tscn"

signal opened(box: GiftBox)

## Cible des objets ejectes. Injectee par le niveau (D.2.4).
var player: Node2D = null

var _remaining_hits: int = 1
var _is_open: bool = false
var _origin: Vector2 = Vector2.ZERO

@onready var _sprite: Sprite2D = $Sprite
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


func _spawn_contents() -> void:
	var scene: PackedScene = load(PICKUP_SCENE) as PackedScene
	if scene == null:
		push_error("[GiftBox] scene d'objet introuvable : %s" % PICKUP_SCENE)
		return
	var parent: Node = get_parent()
	for i: int in range(maxi(1, content_count)):
		var pickup: Pickup = scene.instantiate() as Pickup
		pickup.item_id = content_id
		pickup.amber_value = amber_value
		parent.add_child(pickup)
		# Les objets s'ecartent en eventail : trois objets qui partent
		# exactement au meme endroit ressemblent a un seul.
		var spread: float = 0.0
		if content_count > 1:
			spread = lerpf(
				-SPREAD_PIXELS, SPREAD_PIXELS, float(i) / float(content_count - 1)
			)
		pickup.launch(global_position, player, spread)


func _play_break_effect() -> void:
	var tween: Tween = create_tween().set_parallel(true)
	tween.tween_property(_sprite, "scale", Vector2(1.35, 0.6), 0.10)
	tween.tween_property(_sprite, "modulate:a", 0.0, 0.16)
	tween.chain().tween_callback(queue_free)


func is_open() -> bool:
	return _is_open
