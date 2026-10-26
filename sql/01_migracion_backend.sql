-- =========================================================
-- BIOFLORA · Migración del backend v2
-- Ejecutar UNA vez sobre la base ya creada:  mysql -u root -p bioflora < 01_migracion_backend.sql
-- (Es repetible: usa DROP PROCEDURE IF EXISTS.)
-- Después, copia estos procedimientos a tu script principal para que quede un solo archivo.
-- =========================================================
set names utf8mb4;
use bioflora;

delimiter //

-- [NUEVO] Lo usa el middleware para comprobar en cada petición que el usuario siga activo
drop procedure if exists pa_obtener_usuario//
create procedure pa_obtener_usuario(in id int)
reads sql data
begin
    select usuarios.id_usuario, usuarios.nombre, usuarios.estado, roles.nombre as rol
    from usuarios
    inner join roles on roles.id_rol = usuarios.id_rol
    where usuarios.id_usuario = id;
end//

-- [NUEVO] Lista TODOS los productos (activos e inactivos) para el panel de administración
drop procedure if exists pa_listar_productos_admin//
create procedure pa_listar_productos_admin()
reads sql data
begin
    select productos.id_producto, productos.nombre, productos.descripcion, productos.precio, productos.stock, productos.nivel_luz,
    productos.frecuencia_riego, productos.tamano, productos.uso, productos.imagen, productos.estado,
    productos.id_categoria, categorias.nombre as categoria
    from productos
    inner join categorias on categorias.id_categoria = productos.id_categoria
    order by productos.id_producto;
end//

-- [NUEVO] Guías para la página pública: solo de productos activos
drop procedure if exists pa_listar_guias_publicas//
create procedure pa_listar_guias_publicas()
reads sql data
begin
    select guias_cuidado.id_guia, guias_cuidado.id_producto, productos.nombre as producto, guias_cuidado.titulo,
    guias_cuidado.contenido, guias_cuidado.tipo_guia, guias_cuidado.nivel_dificultad, guias_cuidado.fecha_publicacion
    from guias_cuidado
    inner join productos on productos.id_producto = guias_cuidado.id_producto
    where productos.estado = 1
    order by productos.nombre, guias_cuidado.tipo_guia;
end//

-- [CORREGIDO] Valida el estado y las transiciones permitidas:
--   Pendiente -> En preparación | Entregado | Cancelado
--   En preparación -> Entregado | Cancelado
--   Entregado y Cancelado son finales (así no se "cancela" un pedido ya entregado devolviendo stock)
drop procedure if exists pa_cambiar_estado_pedido//
create procedure pa_cambiar_estado_pedido(in pedido int, in nuevo varchar(20))
modifies sql data
begin
    declare actual varchar(20);

    select pedidos.estado into actual
    from pedidos
    where pedidos.id_pedido = pedido;

    if actual is null then
        signal sqlstate '45000' set message_text = 'Pedido no encontrado';
    end if;
    if nuevo not in ('Pendiente', 'En preparación', 'Entregado', 'Cancelado') then
        signal sqlstate '45000' set message_text = 'Estado de pedido inválido';
    end if;

    if nuevo <> actual then
        if actual in ('Entregado', 'Cancelado') or (actual = 'En preparación' and nuevo = 'Pendiente') then
            signal sqlstate '45000' set message_text = 'Transición de estado no permitida';
        end if;
        update pedidos set pedidos.estado = nuevo
        where pedidos.id_pedido = pedido;
    end if;
end//

-- [CORREGIDO] No permite desactivar administradores y avisa si el usuario no existe
drop procedure if exists pa_cambiar_estado_usuario//
create procedure pa_cambiar_estado_usuario(in id int, in est tinyint)
modifies sql data
begin
    declare nombre_rol varchar(30);

    select roles.nombre into nombre_rol
    from usuarios
    inner join roles on roles.id_rol = usuarios.id_rol
    where usuarios.id_usuario = id;

    if nombre_rol is null then
        signal sqlstate '45000' set message_text = 'Usuario no encontrado';
    end if;
    if nombre_rol = 'Administrador' and est = 0 then
        signal sqlstate '45000' set message_text = 'No se puede desactivar a un administrador';
    end if;

    update usuarios set usuarios.estado = est
    where usuarios.id_usuario = id;
end//

-- [CORREGIDO] Reinicia las variables en cada vuelta del ciclo: antes, si un producto no existía,
-- conservaba el stock/precio del producto anterior y fallaba con un error genérico.
drop procedure if exists pa_crear_pedido_completo//
create procedure pa_crear_pedido_completo(
    in p_usuario   int,
    in p_tipo      varchar(30),
    in p_direccion varchar(200),
    in p_items     json
)
modifies sql data
begin
    declare v_activo      tinyint;
    declare v_id_pedido   int;
    declare v_total_items int;
    declare v_i           int default 0;
    declare v_id_producto int;
    declare v_cantidad    int;
    declare v_stock       int;
    declare v_visible     tinyint;
    declare v_precio      decimal(8,2);

    declare exit handler for sqlexception
    begin
        rollback;
        resignal;
    end;

    select usuarios.estado into v_activo
    from usuarios where usuarios.id_usuario = p_usuario;
    if v_activo is null or v_activo = 0 then
        signal sqlstate '45000' set message_text = 'Usuario no disponible';
    end if;

    if p_tipo not in ('Retiro en la institución', 'Domicilio') then
        signal sqlstate '45000' set message_text = 'Tipo de entrega inválido';
    end if;
    if p_tipo = 'Domicilio' and (p_direccion is null or p_direccion = '') then
        signal sqlstate '45000' set message_text = 'Dirección requerida para entrega a domicilio';
    end if;

    if p_items is null or json_type(p_items) <> 'ARRAY' then
        signal sqlstate '45000' set message_text = 'Items debe ser un arreglo JSON';
    end if;
    set v_total_items = json_length(p_items);
    if v_total_items is null or v_total_items = 0 then
        signal sqlstate '45000' set message_text = 'El carrito está vacío';
    end if;

    start transaction;

    insert into pedidos (id_usuario, tipo_entrega, direccion_entrega)
    values (p_usuario, p_tipo, p_direccion);
    set v_id_pedido = last_insert_id();

    while v_i < v_total_items do
        set v_id_producto = cast(json_extract(p_items, concat('$[', v_i, '].id_producto')) as signed);
        set v_cantidad    = cast(json_extract(p_items, concat('$[', v_i, '].cantidad'))    as signed);

        if v_id_producto is null or v_cantidad is null or v_cantidad <= 0 then
            signal sqlstate '45000' set message_text = 'Item de carrito inválido (id_producto y cantidad requeridos)';
        end if;

        -- reinicio: un SELECT ... INTO sin filas NO borra el valor anterior
        set v_stock = null, v_visible = null, v_precio = null;

        select productos.stock, productos.estado, productos.precio
          into v_stock, v_visible, v_precio
        from productos
        where productos.id_producto = v_id_producto
        for update;

        if v_stock is null or v_visible = 0 then
            signal sqlstate '45000' set message_text = 'Producto no disponible';
        end if;
        if v_stock < v_cantidad then
            signal sqlstate '45000' set message_text = 'Stock insuficiente';
        end if;

        insert into detalle_pedido (id_pedido, id_producto, cantidad, precio_unitario, subtotal)
        values (v_id_pedido, v_id_producto, v_cantidad, v_precio, 0);

        set v_i = v_i + 1;
    end while;

    commit;

    select v_id_pedido as id_pedido;
end//

delimiter ;

-- =========================================================
-- PERMISOS: mínimo privilegio
-- La app solo necesita EXECUTE sobre los procedimientos y SELECT sobre las vistas de reportes.
-- (Los procedimientos corren con los permisos de su definidor, así que NO hace falta SELECT directo
--  a las tablas. Con 'GRANT SELECT ON bioflora.*' la app podría leer usuarios.contrasena.)
-- =========================================================
grant execute on bioflora.* to 'bioflora_app'@'localhost';
grant select on bioflora.v_catalogo to 'bioflora_app'@'localhost';
grant select on bioflora.v_ventas_por_mes to 'bioflora_app'@'localhost';
grant select on bioflora.v_productos_mas_vendidos to 'bioflora_app'@'localhost';
grant select on bioflora.v_pedidos_por_estado to 'bioflora_app'@'localhost';
grant select on bioflora.v_pedidos_recientes to 'bioflora_app'@'localhost';

-- Si en algún momento ejecutaste "GRANT SELECT ON bioflora.*", quítalo con la línea de abajo
-- (si responde ERROR 1141 "There is no such grant", significa que ya no lo tenías: ignóralo).
-- revoke select on bioflora.* from 'bioflora_app'@'localhost';
flush privileges;
