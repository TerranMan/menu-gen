# подключаем библиотеки
import PySimpleGUI as sg
import random
import yaml


## sdfsfsf sdf sdf sdf 
## что будет внутри окна
## первым описываем кнопку и сразу указываем размер шрифта
#layout = [[sg.Button('Новое число',enable_events=True, key='-FUNCTION-', font='Helvetica 16')],
#        # затем делаем текст
#        [sg.Text('Результат:', size=(25, 1), key='-text-', font='Helvetica 16')]]
## рисуем окно
#window = sg.Window('Генератор случайных чисел', layout, size=(350,100))
## запускаем основной бесконечный цикл
#while True:
#    # получаем события, произошедшие в окне
#    event, values = window.read()
#    # если нажали на крестик
#    if event in (sg.WIN_CLOSED, 'Exit'):
#        # выходим из цикла
#        break
## закрываем окно и освобождаем используемые ресурсы
#window.close()

settings = {}

with open("settings.yaml", "w+") as stream:
    try:
        settings = yaml.safe_load(stream))
    except yaml.YAMLError as exc:
        print(exc)






f = open('settings.yml', 'w+')
try:
   # работа с файлом
    setting


finally:
   f.close()
re

def generate_menu ( settings) :
    for type in setting.







    
dishes_amount = get-content -file .settings.xml

function generate_menu (dishes_amount)
{
dishes_result = @{}
foreach(type in dishes_amount.type)
    rand = new Random();
    for (int i=0;i<dishes_amount.
    rand.Shuffle(type.values);
    dishes_result.add("type","rand")
}