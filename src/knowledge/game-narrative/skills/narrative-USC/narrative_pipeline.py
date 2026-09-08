import json

class NarrativeWorkflow:
    def __init__(self):
        self.context = {}

    def run_premise_skill(self, genre, emotion, keywords):
        print(f"--- Running Premise Skill for {genre} ---")
        # 模拟 LLM 调用输出
        result = {
            "premise_statement": f"在{genre}背景下，一个寻找{emotion}的故事。",
            "protagonist_brief": "孤独的幸存者",
            "objective": "寻找失落的记忆",
            "antagonistic_force": "遗忘的阴影",
            "dramatic_question": "他能否在黑暗降临前记起真相？"
        }
        self.context['premise'] = result
        return result

    def run_character_skill(self, role="主角"):
        print(f"--- Running Character Skill for {role} ---")
        premise = self.context.get('premise', {})
        # 模拟 LLM 调用输出
        result = {
            "name": "K",
            "internal_need": "归属感",
            "external_want": premise.get("objective"),
            "conflict": "真相可能会摧毁他现有的平静",
            "arc_type": "上升"
        }
        self.context['characters'] = self.context.get('characters', []) + [result]
        return result

    def run_world_skill(self, setting):
        print(f"--- Running World Building Skill for {setting} ---")
        # 模拟 LLM 调用输出
        result = {
            "world_name": "Neo-Elysium",
            "physical_rules": "重力异常区",
            "social_structure": "AI 统治的阶级社会"
        }
        self.context['world'] = result
        return result

    def generate_full_narrative(self, genre, emotion, keywords, setting):
        self.run_premise_skill(genre, emotion, keywords)
        self.run_character_skill(role="主角")
        self.run_world_skill(setting)
        
        print("\n--- Final Narrative Context ---")
        print(json.dumps(self.context, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    workflow = NarrativeWorkflow()
    workflow.generate_full_narrative("赛博朋克", "忧郁", ["霓虹", "雨夜", "记忆"], "近未来废土")
