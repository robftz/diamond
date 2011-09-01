// This var holds a function which is called
// after the player makes a play or skips their turn.
// it strings together the multiple automated bits
// of the player turn.
//
// This was originally handled by a state machine,
// but the turns are very linear so this code should
// be simpler and more maintainable.
var on_next_player_action = null;

function do_player_turn_1(game, player, draw_cards) {

    game['current_phase'] = 0;
    qfx({'action': 'next_phase'});

    heal(game, player); 
    draw(game, player, draw_cards); 

    // wait for player to make play 1 
    on_next_player_action = do_player_turn_2;
    game['current_phase'] ++; 
    qfx({'action': 'next_phase'});

    // if no cards in player hand, skip UI phase
    if (game['players'][player]['hand'].length == 0) {
        // no hand cards, skip phase
        game['current_phase'] ++; 
        qfx({'action': 'next_phase'});
        on_next_player_action(game, player);
    }
    else {
        qfx({
                'action': 'alert',
                'target': { 
                    'title': "It's the first half of your turn!",
                    'contents': "Pick a card to play, tech up, or skip your turn",
                    'wait_for_confirm': true
                }
            }); 
    }
}

function do_player_turn_2(game, player) {

    // attack!
    do_attack_phase(game, player)

    if (is_game_over(game)) {
        alert("game over from game master");
        var winner = is_game_over(game);
        if (winner == player_name) {
            qfx({ 'action': 'win' });
        }
        else {
            qfx({ 'action': 'lose' });
        } 
        qfx_game_over();
        $.post("/playing/end_turn/",
            $("#current_turn").serialize(),
            function(data) {
                alert('game over i think: ' + data);
            });
        return;
    } 

    // wait for player to make play 2 
    on_next_player_action = do_player_turn_3;
    game['current_phase'] ++; 
    qfx({'action': 'next_phase'});

    // if no cards in player hand, skip UI phase
    if (game['players'][player]['hand'].length == 0) {
        // no hand cards, skip phase
        game['current_phase'] ++; 
        qfx({'action': 'next_phase'});
        on_next_player_action(game, player);
    }
    else {
        qfx({
                'action': 'alert',
                'target': { 
                    'title': "It's the second half of your turn!",
                    'contents': "Pick a card to play, tech up, or skip your turn",
                    'wait_for_confirm': true
                }
            }); 
    }
}

function do_player_turn_3(game, player) {

    remove_rubble(game, player);

    // end turn
    on_next_player_action = null;
    game['current_phase'] ++; 
    qfx({'action': 'next_phase'});

    $.post("/playing/end_turn/",
        $("#current_turn").serialize(),
        function(data) {
            turn_data = eval('(' + data + ')');

            //do AI turn 
            do_turn(game, opponent_name, turn_data['ai_turn']);
            do_player_turn_1(game, player_name, turn_data['player_draw']);
        }
    ); 
    $("textarea[name='player_turn']").val("");
}

function do_turn(game, player, moves) { 

    // heal
    heal(game, player);

    // ai doesn't need to draw

    game['current_phase'] ++; 
    qfx({'action': 'next_phase'}); 

    // first play
    do_turn_move(game, player, moves[0])

    game['current_phase'] ++; 
    qfx({'action': 'next_phase'});

    // attack!
    do_attack_phase(game, player)

    if (is_game_over(game)) {
        var winner = is_game_over(game);
        if (winner == player_name) {
            qfx({ 'action': 'win' });
        }
        else {
            qfx({ 'action': 'lose' });
        } 
        qfx_game_over();
        $.post("/playing/end_turn/",
            $("#current_turn").serialize(),
            function(data) {
                alert('game over from server: ' + data);
            });
        return;
    }

    game['current_phase'] ++; 
    qfx({'action': 'next_phase'});

    // second play
    do_turn_move(game, player, moves[1])

    game['current_phase'] ++; 
    qfx({'action': 'next_phase'});

    // cleanup
    remove_rubble(game, player)

    game['current_phase'] ++; 
    qfx({'action': 'next_phase'});
}


function do_turn_move(game, player, move) { 

    var action = move['action'] 

    if (action == 'pass') {
        return;
    }

    else if (action == "surrender") {
        alert("TODO surrender");
        
        return;
    }

    else if (action == 'tech') {
        var card_id = move['card']['pk']

        discard(game, player, card_id) 

        tech(game, player, 1);
    }

    else if (action == 'play') {
        card = move['card']
        node_owner = move['node']['player']
        row = move['node']['row']
        x = move['node']['x']

        play(game, player, card, node_owner, row, x)
    }
}


function draw(game, player, cards) {
    for (var i = 0; i < cards.length; i ++) {
        get_player(game, player)['hand'].push(cards[i]);
        qfx({
                'action': 'draw',
                'target': player,
                'delta': cards[i]
                }); 
    }
}

// return False if was an illegal play
function play(game, player, card, node_owner, row, x, ignore_hand) {

    if (!ignore_hand) {
        // remove card from hand
        discard(game, player, card)
    }
            
    nodes = []
    if (card['fields']['target_aiming'] == 'chosen') { 
        nodes.push({ 'row' : row, 'x' : x})
    }

    else if (card['fields']['target_aiming'] == 'all') { 
        for (row = 0; row < 3; row ++) {
            for (col = -row; col < row + 1; col ++) {
                if ( ! get_node(game, node_owner, row, col) ) { 
                    nodes.push({ 'row' : row, 'x' : col }); 
                }
            }
        }
    } 

    for (var i = 0; i < nodes.length; i ++) {
        var node = nodes[i];

        // loop to support 'all node' targetting as well as 'chosen'

        if (card['fields']['tech_change']) {
            tech(game, player, card['fields']['tech_change'])
        }

        if (card['fields']['direct_damage']) {
            // direct damage 
            target = get_node(game, player, node["row"], node['x'])
            if (target && target['type'] == "unit") {
                damage_unit(game, card['fields']['direct_damage'], target, card)
            } 
        }

        if (card['fields']['defense']) { 
            // summon critter

            // add a few fields to the card to represent a unit
            card['type'] = 'unit'
            card['damage'] = 0
            card['player'] = player
            card['row'] = parseInt(node['row'])
            card['x'] = parseInt(node['x'])

            set_node(game, player, node["row"], node["x"], card)
        }
    }
}


function discard(game, player, card) {
    for (var i = 0; i < get_player(game, player)['hand'].length; i ++) {

        var hand_card = get_player(game, player)['hand'][i]

        if (hand_card == card) {
            //remove from array
            get_player(game, player)['hand'].splice(i, 1);

            qfx({ 'action': 'discard', 'value': card });

            return hand_card 
        }
    }
    return null
}


function tech(game, player, amount) {
    get_player(game, player)['tech'] += amount;

    qfx({'action': 'tech', 'target': player, 'delta': amount });
}


function do_attack_phase(game, attacking_player) {

    units = each_unit(game, attacking_player)
    for (var i = 0; i < units.length; i ++) {
            do_attack(game, attacking_player, units[i])
    }
}

function get_attack_path(game, attacking_player, attack_type, row, x) {

    var attacked_player = get_opponent_name(game, attacking_player);

    var alignment = attacking_player;
    var steps_taken = 0;

    path = [];
    path.push( { 'alignment': alignment, 'row': row, 'x': x } ); 

    if (attack_type == "na" || attack_type == "counterattack") {
        // some types of units don't do anything during an active attack
        return
    }

    while (true) {
        if (alignment != attacking_player) {
            d_row = -1
        }
        else if (row == 2) {
            d_row = 0
            alignment = attacked_player
        }
        else {
            d_row = 1
        }

        var row_dir = (attacking_player == game['player'] ? -1 : 1);

        row += d_row
        old_x = x

        if (x != 0 && Math.abs(x) > row) {
            x = row * x / Math.abs(x)
        }

        path.push( { 'alignment': alignment, 'row': row, 'x': x } );

        steps_taken += 1

        if (attack_type == "flying" && steps_taken < 3) {
            // flying units skip the 2 spots in front of them
            continue
        }

        if (alignment == attacking_player && attack_type == "ranged") {
            // ranged units always pass over friendly tiles, so
            // don't even worry about checking collisions
            continue
        }

        var next_node = get_node(game, alignment, row, x);

        if (next_node && next_node['type'] == "unit") {
            if (alignment == attacking_player) {
                // bumped into friendly
                break;
            }
            else if (next_node && next_node['type'] == "unit") {
                // bumped into enemy unit
                break;
            }
        }
                
        else if (row == 0 && x == 0) {
            // bumped into enemy player
            break;
        }
    }
    return path;
}

function do_attack(game, attacking_player, unit) {

    var attacked_player = get_opponent_name(game, attacking_player);

    var row = parseInt(unit['row']);
    var x = parseInt(unit['x']);

    var alignment = attacking_player;
    var steps_taken = 0;

    var fields = unit['fields'];

    if (fields['attack_type'] == "na" || fields['attack_type'] == "counterattack") {
        // some types of units don't do anything during an active attack
        return
    }

    move_effects = [];

    while (true) {
        if (alignment != attacking_player) {
            d_row = -1
        }
        else if (row == 2) {
            d_row = 0
            alignment = attacked_player
        }
        else {
            d_row = 1
        }

        var row_dir = (attacking_player == game['player'] ? -1 : 1);

        row += d_row
        old_x = x

        if (x != 0 && Math.abs(x) > row) {
            x = row * x / Math.abs(x)
        }

        var move_effect = { 
                'action': 'move', 
                'target': unit,
                'delta': { 'row': row_dir, 'x': x - old_x }
                }; 

        move_effects.push(move_effect);
        qfx(move_effect);

        steps_taken += 1

        if (fields['attack_type'] == "flying" && steps_taken < 3) {
            // flying units skip the 2 spots in front of them
            continue
        }

        if (alignment == attacking_player && fields['attack_type'] == "ranged") {
            // ranged units always pass over friendly tiles, so
            // don't even worry about checking collisions
            continue
        }

        var next_node = get_node(game, alignment, row, x);

        if (next_node && next_node['type'] == "unit") {
            if (alignment == attacking_player) {
                // bumped into friendly
                break;
            }
            else if (next_node && next_node['type'] == "unit") {
                // bumped into enemy unit

                damage_unit(game, fields['attack'], next_node, unit);
                break;
            }
        }
                
        else if (row == 0 && x == 0) {
            // bumped into enemy player

            if (attacked_player == "ai" && game['goal'] == 'kill units') {
                // in puzzle mode where trying to kill all units, AI is invulnerable
                break;
            }
            else {
                get_player(game, attacked_player)['life'] -= fields['attack'];
                qfx({
                        'action': 'damage_player',
                        'delta': fields['attack'],
                        'target': attacked_player
                        });
                break;
            } 
        }
    }
    for (var i = move_effects.length - 1; i >= 0; i --) {
        // loop through the attack array backwards,
        // looking for movement commands and adding
        // their retreat opposities to the back of 
        // the array
        if (move_effects[i]['action'] == 'move') {
            qfx({ 
                    'action': 'move',
                    'target': move_effects[i]['target'],
                    'delta': { 
                        row: move_effects[i]['delta']['row'] * -1,
                        x: move_effects[i]['delta']['x'] * -1
                    } 
                });
        }
    }
}


function get_player(game, player) { 
    if (!game || !player) {
        alert("unknown game or player in game_master hm");
    }
    return game['players'][player]
}

function get_hand_card(game, player, card_id) {

    var hand = get_player(game, player)['hand'];
    for (i in hand) {
        if (hand[i]['pk'] == card_id) {
            return hand[i];
        }
    }
    return null; 
}


function get_opponent_name(game, player) { 
    for (var player_name in game['players']) {
        if (player_name != player) {
            return player_name 
        }
    }
}


function get_board(game, player) {
    return get_player(game, player)['board']
}


function get_node(game, player, row, x) {
    return get_board(game, player)[row + "_" + x];
}

function set_node(game, player, row, x, val) {
    get_board(game, player)[row + "_" + x] = val;

    if (val['type'] == 'rubble') {
        qfx( { 
                action: 'add_rubble',
                target: {
                    'player': player,
                    'row': row,
                    'x': x
                }
            });
    }
    else if (val['type'] == 'unit') {
        qfx( { 
                action: 'add_unit',
                target: {
                    'player': player,
                    'row': row,
                    'x': x
                },
                value: val
            }); 
    }
    else {
        alert("unknown value type in set_node: " + val['type']);
    } 
}


function each_type(game, player, type) {

    types = []

    board = get_board(game, player) 
    for (row = 0; row < 3; row ++) {
        for (col = -row; col < row + 1; col ++) {
            node = get_node(game, player, row, col)
            node_type = null
            try {
                node_type = node['type']
            }
            catch (KeyError) {
                // blank nodes have no type
                continue
            }
            if ((!type && !node) || (node && node_type == type)) { 
                types.push(node)
            }
        }
    } 
    return types 
}


function each_empty(game, player) {
    return each_type(game, player, undefined)
}

function each_unit(game, player) {

    return each_type(game, player, 'unit')
}


function for_each_unit(game, player, callback) {

    for_each_type(game, player, "unit", callback)
}


function for_each_type(game, player, type, callback) {

    board = get_board(game, player) 
    for (row = 0; row < 3; row ++) {
        for (col = -row; col < row + 1; col ++) {
            node = get_node(game, player, row, col)
            node_type = null
            try {
                node_type = node['type']
            }
            catch (KeyError) {
                // blank nodes have no type
                continue
            }
            if (node && node_type == type) { 
                callback(game, player, node)
            }
        }
    }
}


function remove_rubble(game, player) {

    for_each_type(game, player, "rubble", remove_rubble_from_node)
}


function remove_rubble_from_node(game, player, node) {

    // remove one rubble
    node['fields']['rubble_duration'] -= 1;

    qfx({
            'action': 'remove_rubble',
            'target': node,
            });



    if (node['fields']['rubble_duration'] <= 0) { 
        // if all rubble is removed, clear from board
        set_node(game, player, node['row'], node['x'], {})
    }
}


function heal(game, player) { 
    for_each_unit(game, player, heal_unit)
}


function heal_unit(game, player, unit) {
    var healed = unit['damage'];
    unit['damage'] = 0;
    qfx({
            'action': 'heal_unit',
            'target': unit,
            'delta': healed
        });
}


function damage_unit(game, amount, target, source) {

    if (! target['damage']) {
        target['damage'] = 0
    }

    target['damage'] += amount

    qfx({
                'action': 'damage_unit', 
                'target': target,
                'delta': amount
            });

    if (target['damage'] >= target['fields']['defense']) {
        kill_unit(game, target)
    }
}


function kill_unit(game, target) {

    qfx({
                'action': 'remove_unit', 
                'target': target,
            });

    if (target['fields']['rubble_duration'] > 0) {
        // leave rubble
        target['type'] = 'rubble'

        qfx( {
                'action': 'add_rubble', 
                'target': target,
            } );
    }

    else {
        // remove from game
        board = get_board(game, player)
        set_node(game, player, target['row'], target['x'], {})
    } 
}


// returns name of winner, or false if noone has won
function is_game_over(game) {

    for (player in game['players']) {
        if (game['players'][player]['life'] <= 0) {
            return get_opponent_name(game, player)
        }
    }

    if (game['goal'] == 'kill units') { 
        var opp = get_opponent_name(game, game['player'])
        if (each_unit(game, opp).length == 0) {
            return game['player']
        }
    } 
    return false
}
