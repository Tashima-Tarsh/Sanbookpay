"""Build public operations PDF from the reviewed, secret-free Markdown source."""
from pathlib import Path
from xml.sax.saxutils import escape
import re, shutil
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
ROOT=Path(__file__).resolve().parents[1]
for name,file in [('Regular','segoeui.ttf'),('Bold','segoeuib.ttf')]:
    pdfmetrics.registerFont(TTFont(name,'C:/Windows/Fonts/'+file))
styles={name:ParagraphStyle(name,fontName=font,fontSize=size,leading=leading,spaceAfter=10,textColor=colors.HexColor('#182c28')) for name,font,size,leading in [('title','Bold',25,31),('h2','Bold',13,19),('body','Regular',10,15)]}
styles['h2'].keepWithNext=True
story=[]
for block in (ROOT/'docs/OPERATIONS-MANUAL.md').read_text(encoding='utf-8').split('\n\n'):
    block=block.strip()
    if not block:continue
    if block.startswith('#'):
        heading,_,rest=block.partition('\n')
        style='title' if heading.startswith('# ') else 'h2'
        story.append(Paragraph(escape(re.sub(r'^#{1,2} ','',heading)),styles[style]))
        if rest:story.append(Paragraph(escape(rest).replace('\n','<br/>'),styles['body']))
    else:story.append(Paragraph(escape(block).replace('\n','<br/>'),styles['body']))

def footer(c,doc):
    c.setFillColor(colors.HexColor('#284d44'));c.rect(0,835,595.28,7,fill=1,stroke=0)
    c.setFont('Regular',8);c.drawString(48,28,'Dynamo Pay | Integration and operations | 31 October 2026');c.drawRightString(547,28,str(doc.page))
out=ROOT/'output/pdf/Dynamo-Pay-Operations-Manual.pdf';out.parent.mkdir(parents=True,exist_ok=True)
SimpleDocTemplate(str(out),pagesize=(595.28,841.89),leftMargin=48,rightMargin=48,topMargin=47,bottomMargin=49,title='Dynamo Pay Configuration and Integration',author='Dynamo Pay').build(story,onFirstPage=footer,onLaterPages=footer)
for name in ['dynamo-pay-manual.pdf','dynamo-developer-quick-guide.pdf']:shutil.copyfile(out,ROOT/'apps/merchant-admin/public'/name)
print('Public configuration manual generated; no account secrets included.')
