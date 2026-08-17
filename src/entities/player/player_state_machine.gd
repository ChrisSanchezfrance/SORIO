class_name PlayerStateMachine
extends Node
## Machine a etats de SORIO.
##
## Les etats sont les noeuds enfants de ce noeud : ajouter un etat, c'est
## ajouter un enfant, sans toucher a ce fichier. Le nom du noeud (en
## minuscules) devient le nom de l'etat.

signal state_changed(from: StringName, to: StringName)

## Etat de depart.
const INITIAL_STATE: StringName = &"idle"
## Garde-fou : une transition qui en declenche une autre indefiniment
## bloquerait la frame. On coupe et on signale.
const MAX_CHAINED_TRANSITIONS: int = 8

var current: PlayerState = null
var current_name: StringName = &""
## Nom de l'etat precedent, utile pour les retours (Hurt -> etat d'avant).
var previous_name: StringName = &""

var _states: Dictionary = {}
var _player: Player = null


## Appele par le joueur : la machine ne cherche jamais son proprietaire
## toute seule (regle D.2.4).
func setup(player: Player) -> void:
	assert(player != null, "PlayerStateMachine.setup avec un joueur nul")
	_player = player
	for child: Node in get_children():
		if not (child is PlayerState):
			push_warning("[StateMachine] enfant ignore, n'etend pas PlayerState : %s" % child.name)
			continue
		var state: PlayerState = child as PlayerState
		state.player = player
		_states[StringName(child.name.to_lower())] = state
	assert(_states.has(INITIAL_STATE), "etat initial absent : %s" % INITIAL_STATE)
	_enter(INITIAL_STATE, &"")


func physics_update(delta: float) -> void:
	if current == null:
		return
	var chained: int = 0
	var next: StringName = current.physics_update(delta)
	# Un etat peut en demander un autre immediatement (atterrissage -> idle),
	# on resout la chaine dans la meme frame pour eviter une frame de retard
	# visible a l'oeil.
	while not String(next).is_empty() and chained < MAX_CHAINED_TRANSITIONS:
		change_state(next)
		next = current.physics_update(0.0)
		chained += 1
	if chained >= MAX_CHAINED_TRANSITIONS:
		push_error("[StateMachine] boucle de transitions depuis %s" % current_name)


func change_state(to: StringName) -> void:
	if to == current_name:
		return
	if not _states.has(to):
		push_error("[StateMachine] etat inconnu : %s" % to)
		return
	var from: StringName = current_name
	if current != null:
		current.exit()
	previous_name = from
	_enter(to, from)
	state_changed.emit(from, to)


func _enter(to: StringName, from: StringName) -> void:
	current = _states[to]
	current_name = to
	current.enter(from)


func has_state(name: StringName) -> bool:
	return _states.has(name)


func can_take_damage() -> bool:
	return current != null and current.can_take_damage()
