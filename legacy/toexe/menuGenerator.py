import PySimpleGUI as sg
import random
import yaml

def shuffle(obj):
    random.shuffle(obj)
    return str(obj[0])

def menu_generate(text_output):
    settings = {}

    menu = "\n"
    with open("settings.yml", "r+", encoding="utf-8") as stream:
        try:
            settings = yaml.safe_load(stream)  
            for i in range(len(settings)):
                dishes_result=""
                for j in range(settings[i]['count']):
                    dishes_result += (shuffle(settings[i]['values']))
                    if j+1 < settings[i]['count']:
                        dishes_result += ", "
                    if (settings[i]['count'] > 1) and (j!=0) and ((j % 2) != 0) and (j < settings[i]['count']-1):
                        dishes_result += "\n          "
                menu += settings[i]['name'] + ": \n          " + dishes_result+ "\n"
            text_elem = text_output
            text_elem.update("                                                                         МЕНЮ: {}".format(menu))
        except yaml.YAMLError as exc:
            print(exc)
def main():
    layout = [[sg.Button('Сгенерировать меню',enable_events=True, key='-FUNCTION-', font='Helvetica 14',expand_x = True, expand_y = False)],
              [sg.Text("                                                                         МЕНЮ:\n", size=(800, 550), key='-text-', font='Helvetica 14',),sg.Multiline()]]
    window = sg.Window('Генератор меню на неделю', layout, size=(800,550),resizable=True, finalize=True)
    while True:
        event, values = window.read()
        if event in (sg.WIN_CLOSED, 'Exit'):
            break
        elif event == '-FUNCTION-':
            menu_generate(window['-text-'])
    window.close()

if __name__ == "__main__":
    main()
