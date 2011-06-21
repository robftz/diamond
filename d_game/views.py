import logging
from random import random

from django.http import HttpResponse
from django.shortcuts import render_to_response
from django.core import serializers
from django.template import RequestContext

from d_board.models import Node
from d_cards.models import Card, ShuffledLibrary, Deck
from d_game.models import Turn, Match, Board, Unit, AI


def playing(request): 

    # init
    request.session.flush();
    match = init_match() 
    request.session["match"] = match.id

    board = Node.objects.all().order_by('-pk')

    return render_to_response("playing.html", locals(), context_instance=RequestContext(request))


def init_match():

    deck = Deck.objects.all()[0]

    friendly_library = ShuffledLibrary().init(deck)
    friendly_library.save()
    ai_library = ShuffledLibrary().init(deck)
    ai_library.save()

    # starting hand, to be filled to 5 on first AI turn
    ai_library.draw(3)

    match = Match(friendly_library=friendly_library,
            ai_library=ai_library)
    match.save()

    return match




def end_turn(request):

    logging.info("** end_turn()")

    match = Match.objects.get(id=request.session["match"])
    logging.info("** got match: %s" % match.id)

    board = Board()
    board.load_from_session(request.session)
    board.log()

    # process what the player has just done & update board state

    if request.POST.get("i_win"):
        logging.info("!! player won game !!")

    logging.info("BOARD BEFORE PLAYER HEAL")
    board.log()

    # heal player's units
    board.heal("friendly")

    logging.info("BOARD AFTER PLAYER HEAL")
    board.log()

    # first player cast
    node = None
    node_id = id=request.POST.get("node1")
    if node_id != "tech":
        node = Node.objects.get(id=node_id)

    card_id = request.POST.get("card1")
    card = Card.objects.get(id=card_id) 
    if node:
        board.cast("friendly", card, node)
    else:
        logging.info("!! TODO: tech up friendly 1")

    logging.info("BOARD BEFORE PLAYER ATTACK (AFTER CAST 1)")
    board.log()

    #attack!
    board.do_attack_phase("friendly")

    logging.info("BOARD AFTER PLAYER ATTACK")
    board.log()

    # second player cast
    node = None
    node_id = id=request.POST.get("node2")
    if node_id != "tech":
        node = Node.objects.get(id=node_id)
    card_id = request.POST.get("card2")
    card = Card.objects.get(id=card_id) 
    if node:
        board.cast("friendly", card, node)
    else:
        logging.info("!! TODO: tech up friendly 2")
    
    logging.info("BOARD AFTER PLAYER CAST 2")
    board.log()


    ai_turn = AI().do_turn(match, board)

    logging.info("** did ai turn")

    #get 2 new cards for player
    card_ids = match.friendly_library.draw(2)
    draw_1 = Card.objects.get(id=card_ids[0])
    draw_2 = Card.objects.get(id=card_ids[1])

    logging.info("** drew cards")

    #serialize and ship it
    hand_and_turn_json = """{
            'player_draw': %s,
            'ai_turn': %s,
            'ai_cards': %s,
            }""" % (serializers.serialize("json", [draw_1, draw_2]),
                    serializers.serialize("json", [ai_turn]),
                    serializers.serialize("json", [ai_turn.play_1, ai_turn.play_2]))

    logging.info(hand_and_turn_json);

    return HttpResponse(hand_and_turn_json, "application/javascript")


def draw(request):
    
    match = Match.objects.get(id=request.session["match"])

    card_ids = match.friendly_library.draw(5)
    hand = []

    for id in card_ids:
        card = Card.objects.get(id=id)
        hand.append(card) 

    hand_json = serializers.serialize("json", hand)

    return HttpResponse(hand_json, "application/javascript") 
