import json

class NarrativeLab:
    """
    AI 叙事实验室：从互联网采风到总策划案的自动化工作流
    """
    def __init__(self):
        self.material_pool = []
        self.creative_drafts = []
        self.evaluated_concepts = []

    def scrape_and_parse(self, raw_data):
        """Skill A: 采风与解析"""
        print(f"--- [Skill A] Parsing Raw Content ---")
        # 模拟解析逻辑
        parsed_material = {
            "summary": raw_data[:50] + "...",
            "tags": ["#互联网梗", "#社会事件"],
            "uniqueness_score": 7
        }
        self.material_pool.append(parsed_material)
        return parsed_material

    def brainstorm_reconstruct(self, materials):
        """Skill B: 创意重构拼接"""
        print(f"--- [Skill B] Reconstructing Concepts ---")
        # 模拟重构逻辑：将素材与经典叙事原型拼接
        concept = {
            "name": "拼接创意-X",
            "logic": "将[素材A]的社会讽刺与[素材B]的科幻设定拼接",
            "hook": "如果你的记忆可以像‘梗’一样被全网转发？"
        }
        self.creative_drafts.append(concept)
        return concept

    def evaluate(self, concept):
        """Skill C: 双重评估"""
        print(f"--- [Skill C] Evaluating Concept: {concept['name']} ---")
        evaluation = {
            "creativity": 9,
            "feasibility": 6,
            "scenes": ["独立游戏", "互动影游"],
            "status": "Approved"
        }
        self.evaluated_concepts.append({"concept": concept, "eval": evaluation})
        return evaluation

    def generate_master_gdd(self, index=0):
        """Skill D: 总策划案生成"""
        target = self.evaluated_concepts[index]
        print(f"--- [Skill D] Generating Master GDD for {target['concept']['name']} ---")
        gdd = f"""
        # 游戏叙事总策划案: {target['concept']['name']}
        ## 1. 核心创意
        {target['concept']['hook']}
        ## 2. 评估摘要
        创意分: {target['eval']['creativity']}, 可落地性: {target['eval']['feasibility']}
        ## 3. 适用场景
        {', '.join(target['eval']['scenes'])}
        ... (更多详细内容)
        """
        return gdd

if __name__ == "__main__":
    lab = NarrativeLab()
    # 1. 采风
    lab.scrape_and_parse("最近流行的‘赛博打工人’梗与某传记中的隐居生活...")
    # 2. 脑暴
    concept = lab.brainstorm_reconstruct(lab.material_pool)
    # 3. 评估
    lab.evaluate(concept)
    # 4. 输出策划案
    final_gdd = lab.generate_master_gdd()
    print(final_gdd)
