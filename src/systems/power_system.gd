class_name PowerSystem
extends Node
## Pouvoir actif de SORIO (A.6).
##
## Un seul pouvoir a la fois. Il s'epuise soit au temps, soit a l'usage, et
## **il se voit sur le personnage** : la tunique et le pantalon prennent la
## couleur du pouvoir, un halo l'entoure. C'est le point important pour un
## enfant de 8 ans — il n'a pas a lire une icone de HUD pour savoir de quoi
## il dispose, il le voit sur SORIO.
##
## Regle de A.6 : prendre un degat fait perdre le pouvoir AVANT de retirer un
## PV. Le pouvoir sert donc de bouclier, ce qui recompense la prise de risque
## sans jamais punir durement.

const TINT_SHADER: String = "res://assets/shaders/power_tint.gdshader"

## Couleurs de la tenue par defaut, telles que dessinees par CharacterDrawer.
## Le shader les reconnait pour les remplacer.
const TUNIC_BASE: Color = Color(0.24, 0.68, 0.30)
const TROUSERS_BASE: Color = Color(0.33, 0.27, 0.44)

## Le pouvoir clignote avant de s'eteindre, pour qu'on ne soit jamais
## surpris de le perdre (A.6, regle de la Flamme, generalisee).
const WARNING_SECONDS: float = 2.0
const BLINK_HZ: float = 6.0
## Duree du fondu quand la tenue change : assez court pour etre franc,
## assez long pour qu'on voie la transformation.
const MORPH_SECONDS: float = 0.18

signal power_changed(power: PowerData)

## Sprite a teinter. Injecte par le joueur (D.2.4).
var sprite: CanvasItem = null

var active: PowerData = null
var remaining_time: float = 0.0
var remaining_charges: int = 0

var _material: ShaderMaterial = null
var _morph_tween: Tween = null


func _ready() -> void:
	set_process(false)


## Branche le systeme sur le sprite du personnage.
func setup(target: CanvasItem) -> void:
	assert(target != null, "PowerSystem.setup sans sprite")
	sprite = target
	var shader: Shader = load(TINT_SHADER) as Shader
	if shader == null:
		push_error("[PowerSystem] shader introuvable : %s" % TINT_SHADER)
		return
	_material = ShaderMaterial.new()
	_material.shader = shader
	_material.set_shader_parameter(&"tunic_source", _rgb(TUNIC_BASE))
	_material.set_shader_parameter(&"trousers_source", _rgb(TROUSERS_BASE))
	sprite.material = _material
	_apply_appearance(TUNIC_BASE, TROUSERS_BASE, Color.WHITE, 0.0)


func has_power() -> bool:
	return active != null


## Donne un pouvoir. Remplace celui en cours : un seul actif a la fois (A.6).
func grant(power: PowerData) -> void:
	if power == null:
		return
	active = power
	remaining_time = power.duration
	remaining_charges = power.charges
	set_process(power.is_timed())

	_morph_to(power)
	Game.discover_power(power.id)
	Game.count_power_use(power.id)
	Haptics.pulse(&"power_pickup")
	EventBus.power_acquired.emit(power.id, &"active")
	EventBus.power_activated.emit(power.id)
	power_changed.emit(power)


## Consomme une charge. Retourne false si le pouvoir ne repond pas.
func use_charge() -> bool:
	if active == null or active.is_timed():
		return false
	if remaining_charges <= 0:
		return false
	remaining_charges -= 1
	EventBus.power_charges_changed.emit(active.id, remaining_charges, active.charges)
	if remaining_charges <= 0:
		_expire()
	return true


## Retire le pouvoir. `cause` distingue l'expiration du degat encaisse.
func clear(cause: StringName = &"cleared") -> void:
	if active == null:
		return
	var id: StringName = active.id
	active = null
	remaining_time = 0.0
	remaining_charges = 0
	set_process(false)
	_morph_to(null)
	EventBus.power_expired.emit(id)
	power_changed.emit(null)


## Le pouvoir encaisse le degat a la place des PV (A.6). Retourne true s'il
## a servi de bouclier, auquel cas aucun PV n'est retire.
func absorb_damage() -> bool:
	if active == null:
		return false
	clear(&"damage")
	EventBus.screen_shake_requested.emit(5.0, 0.18)
	return true


func _process(delta: float) -> void:
	if active == null or not active.is_timed():
		return
	remaining_time = maxf(0.0, remaining_time - delta)
	if remaining_time <= 0.0:
		_expire()
		return
	_update_warning_blink()


## Clignotement dans les deux dernieres secondes.
func _update_warning_blink() -> void:
	if sprite == null or remaining_time > WARNING_SECONDS:
		return
	var phase: float = sin(remaining_time * TAU * BLINK_HZ)
	sprite.modulate.a = 1.0 if phase > 0.0 else 0.45


func _expire() -> void:
	if sprite != null:
		sprite.modulate.a = 1.0
	clear(&"expired")


## Fraction restante, pour la jauge circulaire du HUD (A.6).
func remaining_ratio() -> float:
	if active == null:
		return 0.0
	if active.is_timed():
		return clampf(remaining_time / maxf(0.001, active.duration), 0.0, 1.0)
	return clampf(float(remaining_charges) / maxf(1.0, float(active.charges)), 0.0, 1.0)


# --- Apparence --------------------------------------------------------------

func _morph_to(power: PowerData) -> void:
	if sprite != null:
		sprite.modulate.a = 1.0
	var tunic: Color = power.color if power != null else TUNIC_BASE
	var trousers: Color = power.secondary_color() if power != null else TROUSERS_BASE
	var aura: Color = power.color if power != null else Color.WHITE
	var strength: float = power.aura_strength if power != null else 0.0
	_apply_appearance(tunic, trousers, aura, strength, true)


func _apply_appearance(
	tunic: Color, trousers: Color, aura: Color, strength: float, animate: bool = false
) -> void:
	if _material == null:
		return
	_material.set_shader_parameter(&"tunic_target", _rgb(tunic))
	_material.set_shader_parameter(&"trousers_target", _rgb(trousers))
	_material.set_shader_parameter(&"aura_color", _rgb(aura))

	if not animate:
		_material.set_shader_parameter(&"aura_strength", strength)
		return
	# Le halo monte progressivement : une transformation instantanee se lit
	# comme un bug d'affichage plutot que comme un gain de pouvoir.
	if _morph_tween != null and _morph_tween.is_valid():
		_morph_tween.kill()
	_morph_tween = create_tween()
	_morph_tween.tween_method(
		func(value: float) -> void:
			_material.set_shader_parameter(&"aura_strength", value),
		float(_material.get_shader_parameter(&"aura_strength")),
		strength,
		MORPH_SECONDS
	)


static func _rgb(color: Color) -> Vector3:
	return Vector3(color.r, color.g, color.b)


# --- Tirage au sort (A.6) ---------------------------------------------------

## Tire une rarete selon les poids de A.6, puis un pouvoir de cette rarete.
## Si aucune ressource n'existe pour la rarete tiree, on redescend d'un cran
## plutot que de ne rien donner : un cadeau vide serait incomprehensible.
static func roll_random_power(rng: RandomNumberGenerator = null) -> PowerData:
	var generator: RandomNumberGenerator = rng
	if generator == null:
		generator = RandomNumberGenerator.new()
		generator.randomize()

	var roll: int = generator.randi_range(1, 100)
	var order: Array[PowerData.Rarity] = [
		PowerData.Rarity.LEGENDARY, PowerData.Rarity.EPIC,
		PowerData.Rarity.RARE, PowerData.Rarity.COMMON,
	]
	var threshold: int = 0
	var chosen: PowerData.Rarity = PowerData.Rarity.COMMON
	for rarity: PowerData.Rarity in order:
		threshold += int(PowerData.RARITY_WEIGHTS[rarity])
		if roll <= threshold:
			chosen = rarity
			break

	for rarity: PowerData.Rarity in [
		chosen, PowerData.Rarity.RARE, PowerData.Rarity.COMMON,
	]:
		var pool: Array[PowerData] = powers_of_rarity(rarity)
		if not pool.is_empty():
			return pool[generator.randi_range(0, pool.size() - 1)]
	return null


static func powers_of_rarity(rarity: PowerData.Rarity) -> Array[PowerData]:
	var pool: Array[PowerData] = []
	for resource: Resource in Database.all("powers"):
		var power: PowerData = resource as PowerData
		if power != null and power.rarity == rarity:
			pool.append(power)
	return pool
