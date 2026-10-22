import { describe,it,expect } from "vitest";
import { matchesProductSpecification } from "./productResolver.js";
describe("strict commercial size and pressure matching",()=>{
  it.each([
    ['Elbow 25mm','Dura Max Elbow 32mm',false],
    ['Pipe 25 mm PN-16','Dura Max Pipe PN-20 25mm',false],
    ['Elbow 4"','Dura Max Elbow 3 inch',false],
    ['Elbow 4"','Dura Max Elbow 4 inch',true],
    ['Elbow 1-1/4 inch','Dura Max Elbow 1.25 inch',true],
    ['Pipe Schedule 40 4"','Dura Max Pipe Schedule 80 4 inch',false],
    ["Pipe Class 'O' 4 inch","Dura Max Pipe Class 'B' 4 inch",false],
  ])("checks %s against %s",(query,name,expected)=>expect(matchesProductSpecification(query,name)).toBe(expected));
});
